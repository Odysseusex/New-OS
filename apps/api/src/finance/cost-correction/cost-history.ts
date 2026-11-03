import { CostBasis } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { round2 } from "../../common/money";
import { stockSignOf } from "../../common/ledger-effects";
import { CostFlow } from "./replay";

export type HistoryClient = Pick<PrismaService, "product" | "stockMovement" | "stockLevel" | "purchaseOrderItem" | "productionBatchCost">;

// What a flow was, for a person: the turnover statement groups by it.
export type FlowGroup =
  | "OPENING" // stock on the shelf before any movement was recorded
  | "PURCHASE" // from a supplier (order, invoice, Склад → Приёмка)
  | "SUPPLIER_RETURN" // handed back to the supplier
  | "RECEIPT_OTHER" // Склад → Приёмка without a price
  | "PRODUCTION_OUTPUT"
  | "PRODUCTION_CONSUMPTION"
  | "SALE"
  | "SALE_RETURN"
  | "WRITE_OFF"
  | "ADJUSTMENT"
  | "TRANSFER";

export interface FlowMeta {
  locationId: string | null;
  group: FlowGroup;
  // +1 stock in, −1 stock out (MOVE and returned-PURCHASE flows also carry the
  // sign in their quantity; read the magnitude with Math.abs).
  sign: 1 | -1;
}

export interface CostHistory {
  flows: CostFlow[];
  meta: Map<number, FlowMeta>;
  batchUntracked: Map<string, number>;
  startingAverage: Map<string, number>;
  products: { id: string; name: string; unit: string; type: string; categoryId: string | null }[];
}

// Everything the cost walk (replay.ts) needs, read once, up to `upTo`:
//   · stock movements (annulled ones left out; transfers between points come as
//     MOVE flows — the network average does not move, a point's view needs them);
//   · a purchase order's receipt is taken from the ORDER as it stands now
//     (corrected quantity and price, at the receipt date), not from its
//     movements, so a correction made later is in its place;
//   · a batch's cost that never was stock (an untracked ingredient) from its
//     stamped ingredient cost minus what its consumption rows carried.
// Goods «под реализацию» and products without stock tracking have no cost of
// ours on the shelf and are not walked.
//
// Stock that was on the shelf before the first movement was recorded (a level
// with no history behind it, per point) is put at the very start of the walk,
// valued at the first average the product ever had stamped (else its card
// price) — without it the walk would think the shelf was empty and get every
// average wrong.
export async function loadCostHistory(client: HistoryClient, organizationId: string, upTo: Date): Promise<CostHistory> {
  const [products, movements, orderLines, batchCosts, levels, ledgerSums] = await Promise.all([
    client.product.findMany({
      where: { organizationId },
      select: { id: true, name: true, unit: true, type: true, categoryId: true, price: true, trackInventory: true, consignmentSupplierId: true },
    }),
    client.stockMovement.findMany({
      where: { organizationId, createdAt: { lte: upTo }, voidLine: null },
      select: {
        id: true,
        type: true,
        productId: true,
        locationId: true,
        quantity: true,
        unitCost: true,
        costBasis: true,
        createdAt: true,
        batchId: true,
        purchaseOrderId: true,
        invoiceId: true,
        saleReturnId: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.purchaseOrderItem.findMany({
      where: { purchaseOrder: { organizationId, status: "RECEIVED", receivedAt: { lte: upTo } } },
      select: {
        productId: true,
        quantity: true,
        unitCost: true,
        receivedQuantity: true,
        receivedUnitCost: true,
        purchaseOrder: { select: { receivedAt: true, locationId: true } },
      },
    }),
    client.productionBatchCost.findMany({
      where: { component: "INGREDIENT", batch: { organizationId, completedAt: { lte: upTo } } },
      select: { batchId: true, amount: true },
    }),
    client.stockLevel.groupBy({ by: ["productId", "locationId"], where: { organizationId }, _sum: { quantity: true } }),
    client.stockMovement.groupBy({
      by: ["productId", "locationId", "type"],
      where: { organizationId, NOT: { type: "WRITE_OFF", saleReturnId: { not: null } } },
      _sum: { quantity: true },
    }),
  ]);

  const walked = new Set(products.filter((p) => p.trackInventory && !p.consignmentSupplierId).map((p) => p.id));
  const startingPrice = new Map(products.map((p) => [p.id, p.price.toNumber()]));
  const flows: CostFlow[] = [];
  const meta = new Map<number, FlowMeta>();
  const consumedStamped = new Map<string, number>();
  let order = 0;
  const push = (flow: CostFlow, m: FlowMeta) => {
    flows.push(flow);
    meta.set(flow.order, m);
  };

  for (const line of orderLines) {
    if (!walked.has(line.productId) || !line.purchaseOrder.receivedAt) continue;
    const quantity = (line.receivedQuantity ?? line.quantity).toNumber();
    if (!(quantity > 0)) continue;
    push(
      {
        kind: "PURCHASE",
        at: line.purchaseOrder.receivedAt.getTime(),
        order: order++,
        productId: line.productId,
        quantity,
        unitCost: (line.receivedUnitCost ?? line.unitCost).toNumber(),
      },
      { locationId: line.purchaseOrder.locationId, group: "PURCHASE", sign: 1 },
    );
  }

  for (const m of movements) {
    if (!walked.has(m.productId)) continue;
    const at = m.createdAt.getTime();
    const quantity = m.quantity.toNumber();
    const stamped = m.unitCost !== null ? m.unitCost.toNumber() : null;
    const base = { at, order: order++, productId: m.productId };
    const where = (group: FlowGroup, sign: 1 | -1): FlowMeta => ({ locationId: m.locationId, group, sign });
    switch (m.type) {
      case "RECEIPT":
        // An order's receipt (and its corrections) comes from the order itself.
        if (m.purchaseOrderId) break;
        if (stamped !== null && quantity > 0 && (m.invoiceId || m.costBasis === CostBasis.PURCHASE_ACTUAL)) {
          push({ kind: "PURCHASE", ...base, quantity, unitCost: stamped }, where("PURCHASE", 1));
        } else if (quantity > 0) {
          push({ kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "NONE" }, where("RECEIPT_OTHER", 1));
        } else if (quantity < 0) {
          push({ kind: "OUT", ...base, quantity: -quantity, stampedUnitCost: stamped, category: "NONE" }, where("RECEIPT_OTHER", -1));
        }
        break;
      case "SALE":
        push({ kind: "OUT", ...base, quantity, stampedUnitCost: stamped, category: "COGS" }, where("SALE", -1));
        break;
      case "SALE_RETURN":
        push({ kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "COGS" }, where("SALE_RETURN", 1));
        break;
      case "WRITE_OFF":
        // A return that went in the bin never came back on the shelf: no stock effect.
        if (m.saleReturnId) break;
        push({ kind: "OUT", ...base, quantity, stampedUnitCost: stamped, category: "LOSS" }, where("WRITE_OFF", -1));
        break;
      case "ADJUSTMENT":
        if (quantity > 0) push({ kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "LOSS" }, where("ADJUSTMENT", 1));
        else if (quantity < 0) push({ kind: "OUT", ...base, quantity: -quantity, stampedUnitCost: stamped, category: "LOSS" }, where("ADJUSTMENT", -1));
        break;
      case "PRODUCTION_CONSUMPTION":
        push(
          { kind: "OUT", ...base, quantity, stampedUnitCost: stamped, category: "PRODUCTION", batchId: m.batchId ?? undefined },
          where("PRODUCTION_CONSUMPTION", -1),
        );
        if (m.batchId && stamped !== null) {
          consumedStamped.set(m.batchId, (consumedStamped.get(m.batchId) ?? 0) + round2(quantity * stamped));
        }
        break;
      case "PRODUCTION_OUTPUT":
        if (m.batchId) push({ kind: "OUTPUT", ...base, quantity, stampedUnitCost: stamped, batchId: m.batchId }, where("PRODUCTION_OUTPUT", 1));
        else push({ kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "NONE" }, where("PRODUCTION_OUTPUT", 1));
        break;
      case "SUPPLIER_RETURN":
        // Back to the supplier at the price it came in at: a purchase undone.
        push(
          { kind: "PURCHASE", ...base, quantity: -quantity, unitCost: stamped ?? startingPrice.get(m.productId) ?? 0 },
          where("SUPPLIER_RETURN", -1),
        );
        break;
      case "TRANSFER_IN":
        push({ kind: "MOVE", ...base, quantity }, where("TRANSFER", 1));
        break;
      case "TRANSFER_OUT":
        push({ kind: "MOVE", ...base, quantity: -quantity }, where("TRANSFER", -1));
        break;
    }
  }

  // Stock with no history behind it, per point: what the shelf holds now minus
  // what all the movements ever recorded there explain.
  const explained = new Map<string, number>();
  for (const g of ledgerSums) {
    const sign = stockSignOf(g.type);
    const q = g._sum.quantity?.toNumber() ?? 0;
    const key = `${g.productId}|${g.locationId}`;
    explained.set(key, (explained.get(key) ?? 0) + (sign === "SIGNED" ? q : sign * q));
  }
  // The first cost stamped at the AVERAGE of its moment (a priced receipt
  // carries its own price, not the average of what was already there).
  const firstStamp = new Map<string, number>();
  for (const m of movements) {
    const pricedReceipt = m.type === "RECEIPT" && (m.purchaseOrderId || m.invoiceId || m.costBasis === CostBasis.PURCHASE_ACTUAL);
    if (m.unitCost !== null && !pricedReceipt && !firstStamp.has(m.productId)) firstStamp.set(m.productId, m.unitCost.toNumber());
  }
  const startingAverage = new Map(products.map((p) => [p.id, firstStamp.get(p.id) ?? p.price.toNumber()]));
  let openingOrder = -1;
  for (const level of levels) {
    if (!walked.has(level.productId)) continue;
    const missing = (level._sum.quantity?.toNumber() ?? 0) - (explained.get(`${level.productId}|${level.locationId}`) ?? 0);
    if (missing <= 0.0005) continue;
    push(
      {
        kind: "PURCHASE",
        at: Number.MIN_SAFE_INTEGER,
        order: openingOrder--,
        productId: level.productId,
        quantity: missing,
        unitCost: startingAverage.get(level.productId) ?? 0,
      },
      { locationId: level.locationId, group: "OPENING", sign: 1 },
    );
  }

  const batchUntracked = new Map<string, number>();
  for (const cost of batchCosts) {
    batchUntracked.set(cost.batchId, cost.amount.toNumber() - (consumedStamped.get(cost.batchId) ?? 0));
  }

  return {
    flows,
    meta,
    batchUntracked,
    startingAverage,
    products: products
      .filter((p) => walked.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, unit: p.unit as string, type: p.type as string, categoryId: p.categoryId })),
  };
}
