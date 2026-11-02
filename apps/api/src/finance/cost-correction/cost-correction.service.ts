import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CostBasis, CostCorrectionDto, CostCorrectionLineDto } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthenticatedUser } from "../../auth/auth.types";
import { recordAudit } from "../../audit/audit";
import { postLedgerSources } from "../../ledger/event-posting";
import { monthRange } from "../../common/reporting-period";
import { round2 } from "../../common/money";
import { stockSignOf } from "../../common/ledger-effects";
import { CostFlow, replayCosts, ReplayResult } from "./replay";

type Client = Pick<PrismaService, "product" | "stockMovement" | "stockLevel" | "purchaseOrderItem" | "productionBatchCost">;

// Reads the history the month-end correction walks (replay.ts) and lays the
// result out for a person. Read-only: nothing here writes.
//
// Where each figure comes from:
//   · stock movements up to the end of the month (annulled ones and transfers
//     between points left out — one average for the network);
//   · a purchase order's receipt is taken from the ORDER as it stands now
//     (corrected quantity and price, at the receipt date), not from its
//     movements, so a correction made later is in its place;
//   · a batch's cost that never was stock (an untracked ingredient) from its
//     stamped ingredient cost minus what its consumption rows carried.
// Goods «под реализацию» and products without stock tracking have no cost of
// ours on the shelf and are not walked.
//
// Stock that was on the shelf before the first movement was recorded (a level
// with no history behind it) is put at the very start of the walk, valued at
// the first average the product ever had stamped (else its card price) — without
// it the walk would think the shelf was empty and get every average wrong.
@Injectable()
export class CostCorrectionService {
  constructor(private prisma: PrismaService) {}

  async compute(organizationId: string, year: number, month: number, client: Client = this.prisma): Promise<{ result: ReplayResult; names: Map<string, { name: string; unit: string }> }> {
    const range = monthRange(year, month);
    const [products, movements, orderLines, batchCosts, levels, ledgerSums] = await Promise.all([
      client.product.findMany({
        where: { organizationId },
        select: { id: true, name: true, unit: true, price: true, trackInventory: true, consignmentSupplierId: true },
      }),
      client.stockMovement.findMany({
        where: {
          organizationId,
          createdAt: { lte: range.end },
          voidLine: null,
          type: { notIn: ["TRANSFER_IN", "TRANSFER_OUT"] },
        },
        select: {
          id: true,
          type: true,
          productId: true,
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
        where: { purchaseOrder: { organizationId, status: "RECEIVED", receivedAt: { lte: range.end } } },
        select: {
          productId: true,
          quantity: true,
          unitCost: true,
          receivedQuantity: true,
          receivedUnitCost: true,
          purchaseOrder: { select: { receivedAt: true } },
        },
      }),
      client.productionBatchCost.findMany({
        where: { component: "INGREDIENT", batch: { organizationId, completedAt: { lte: range.end } } },
        select: { batchId: true, amount: true },
      }),
      client.stockLevel.groupBy({ by: ["productId"], where: { organizationId }, _sum: { quantity: true } }),
      client.stockMovement.groupBy({
        by: ["productId", "type"],
        where: { organizationId, NOT: { type: "WRITE_OFF", saleReturnId: { not: null } } },
        _sum: { quantity: true },
      }),
    ]);

    const walked = new Set(products.filter((p) => p.trackInventory && !p.consignmentSupplierId).map((p) => p.id));
    const flows: CostFlow[] = [];
    const consumedStamped = new Map<string, number>();
    let order = 0;

    for (const line of orderLines) {
      if (!walked.has(line.productId) || !line.purchaseOrder.receivedAt) continue;
      const quantity = (line.receivedQuantity ?? line.quantity).toNumber();
      if (!(quantity > 0)) continue;
      flows.push({
        kind: "PURCHASE",
        at: line.purchaseOrder.receivedAt.getTime(),
        order: order++,
        productId: line.productId,
        quantity,
        unitCost: (line.receivedUnitCost ?? line.unitCost).toNumber(),
      });
    }

    for (const m of movements) {
      if (!walked.has(m.productId)) continue;
      const at = m.createdAt.getTime();
      const quantity = m.quantity.toNumber();
      const stamped = m.unitCost !== null ? m.unitCost.toNumber() : null;
      const base = { at, order: order++, productId: m.productId };
      switch (m.type) {
        case "RECEIPT":
          // An order's receipt (and its corrections) comes from the order itself.
          if (m.purchaseOrderId) break;
          if (stamped !== null && quantity > 0 && (m.invoiceId || m.costBasis === CostBasis.PURCHASE_ACTUAL)) {
            flows.push({ kind: "PURCHASE", ...base, quantity, unitCost: stamped });
          } else if (quantity !== 0) {
            flows.push(quantity > 0
              ? { kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "NONE" }
              : { kind: "OUT", ...base, quantity: -quantity, stampedUnitCost: stamped, category: "NONE" });
          }
          break;
        case "SALE":
          flows.push({ kind: "OUT", ...base, quantity, stampedUnitCost: stamped, category: "COGS" });
          break;
        case "SALE_RETURN":
          flows.push({ kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "COGS" });
          break;
        case "WRITE_OFF":
          // A return that went in the bin never came back on the shelf: no stock effect.
          if (m.saleReturnId) break;
          flows.push({ kind: "OUT", ...base, quantity, stampedUnitCost: stamped, category: "LOSS" });
          break;
        case "ADJUSTMENT":
          if (quantity > 0) flows.push({ kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "LOSS" });
          else if (quantity < 0) flows.push({ kind: "OUT", ...base, quantity: -quantity, stampedUnitCost: stamped, category: "LOSS" });
          break;
        case "PRODUCTION_CONSUMPTION":
          flows.push({ kind: "OUT", ...base, quantity, stampedUnitCost: stamped, category: "PRODUCTION", batchId: m.batchId ?? undefined });
          if (m.batchId && stamped !== null) {
            consumedStamped.set(m.batchId, (consumedStamped.get(m.batchId) ?? 0) + round2(quantity * stamped));
          }
          break;
        case "PRODUCTION_OUTPUT":
          if (m.batchId) flows.push({ kind: "OUTPUT", ...base, quantity, stampedUnitCost: stamped, batchId: m.batchId });
          else flows.push({ kind: "IN", ...base, quantity, stampedUnitCost: stamped, category: "NONE" });
          break;
      }
    }

    // Stock with no history behind it: what the shelf holds now minus what all
    // the movements ever recorded explain.
    const explained = new Map<string, number>();
    for (const g of ledgerSums) {
      const sign = stockSignOf(g.type);
      const q = g._sum.quantity?.toNumber() ?? 0;
      explained.set(g.productId, (explained.get(g.productId) ?? 0) + (sign === "SIGNED" ? q : sign * q));
    }
    // The first cost stamped at the AVERAGE of its moment (a priced receipt
    // carries its own price, not the average of what was already there).
    const firstStamp = new Map<string, number>();
    for (const m of movements) {
      const pricedReceipt = m.type === "RECEIPT" && (m.purchaseOrderId || m.invoiceId || m.costBasis === CostBasis.PURCHASE_ACTUAL);
      if (m.unitCost !== null && !pricedReceipt && !firstStamp.has(m.productId)) firstStamp.set(m.productId, m.unitCost.toNumber());
    }
    const priceOf = new Map(products.map((p) => [p.id, p.price.toNumber()]));
    const startingAverage = new Map(products.map((p) => [p.id, firstStamp.get(p.id) ?? p.price.toNumber()]));
    for (const level of levels) {
      if (!walked.has(level.productId)) continue;
      const missing = (level._sum.quantity?.toNumber() ?? 0) - (explained.get(level.productId) ?? 0);
      if (missing <= 0.0005) continue;
      flows.push({
        kind: "PURCHASE",
        at: Number.MIN_SAFE_INTEGER,
        order: -1,
        productId: level.productId,
        quantity: missing,
        unitCost: startingAverage.get(level.productId) ?? priceOf.get(level.productId) ?? 0,
      });
    }

    const batchUntracked = new Map<string, number>();
    for (const cost of batchCosts) {
      batchUntracked.set(cost.batchId, cost.amount.toNumber() - (consumedStamped.get(cost.batchId) ?? 0));
    }

    const result = replayCosts({ flows, batchUntracked, startingAverage, from: range.start.getTime(), to: range.end.getTime() });
    const names = new Map(products.map((p) => [p.id, { name: p.name, unit: p.unit as string }]));
    return { result, names };
  }

  // The recorded correction of the month (its latest version), else a preview.
  async forMonth(organizationId: string, year: number, month: number): Promise<CostCorrectionDto> {
    const stored = await this.prisma.costCorrection.findFirst({
      where: { organizationId, year, month },
      orderBy: { version: "desc" },
      include: { createdBy: { select: { fullName: true } } },
    });
    if (!stored) return this.preview(organizationId, year, month);
    const cogs = round2(stored.cogsAmount.toNumber());
    const loss = round2(stored.lossAmount.toNumber());
    return {
      year,
      month,
      status: "POSTED",
      version: stored.version,
      computedAt: stored.createdAt.toISOString(),
      postedByName: stored.createdBy.fullName,
      cogsCorrection: cogs,
      lossCorrection: loss,
      totalCorrection: round2(cogs + loss),
      unstampedLines: stored.unstampedLines,
      lines: stored.lines as unknown as CostCorrectionLineDto[],
    };
  }

  // Called by the month's close while the month is CLOSING (no business write
  // can be dated in it then): computes the correction, records it as the next
  // version for the month and lets the ledger post it — and reverse the
  // previous version's entry, whose event the new one replaces. Recorded even
  // when it is zero, so the month says it was checked.
  async record(user: AuthenticatedUser, year: number, month: number): Promise<CostCorrectionDto> {
    const organizationId = user.organizationId;
    const { result, names } = await this.compute(organizationId, year, month);
    const now = new Date();
    const dto = toDto(year, month, result, names, { status: "POSTED", version: null, computedAt: now, postedByName: user.fullName ?? null });
    const created = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.costCorrection.findMany({ where: { organizationId, year, month }, select: { id: true, version: true }, orderBy: { version: "desc" } });
      const version = (previous[0]?.version ?? 0) + 1;
      const row = await tx.costCorrection.create({
        data: {
          organizationId,
          year,
          month,
          version,
          cogsAmount: result.cogsCorrection,
          lossAmount: result.lossCorrection,
          unstampedLines: result.unstampedLines,
          lines: dto.lines as unknown as Prisma.InputJsonValue,
          createdById: user.id,
        },
      });
      await postLedgerSources(tx, {
        organizationId,
        actorId: user.id,
        scope: { costCorrectionIds: [row.id, ...previous.map((p) => p.id)] },
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "costCorrection.record",
        entityType: "CostCorrection",
        entityId: row.id,
        after: { year, month, version, cogsCorrection: result.cogsCorrection, lossCorrection: result.lossCorrection },
      });
      return row;
    });
    return { ...dto, version: created.version, computedAt: created.createdAt.toISOString() };
  }

  async preview(organizationId: string, year: number, month: number): Promise<CostCorrectionDto> {
    const { result, names } = await this.compute(organizationId, year, month);
    return toDto(year, month, result, names, { status: "PREVIEW", version: null, computedAt: new Date(), postedByName: null });
  }
}

// What a person reads: products whose figures moved, the largest first.
export function toDto(
  year: number,
  month: number,
  result: ReplayResult,
  names: Map<string, { name: string; unit: string }>,
  meta: { status: "PREVIEW" | "POSTED"; version: number | null; computedAt: Date; postedByName: string | null },
): CostCorrectionDto {
  const lines: CostCorrectionLineDto[] = result.products
    .map((p) => ({
      productId: p.productId,
      productName: names.get(p.productId)?.name ?? "—",
      unit: names.get(p.productId)?.unit ?? "",
      quantityOut: p.quantityOut,
      cogsStamped: p.cogs.stamped,
      cogsRecomputed: p.cogs.recomputed,
      lossStamped: p.losses.stamped,
      lossRecomputed: p.losses.recomputed,
      productionStamped: p.production.stamped,
      productionRecomputed: p.production.recomputed,
      difference: round2(p.cogs.recomputed - p.cogs.stamped + p.losses.recomputed - p.losses.stamped),
      openingAverage: p.openingAverage !== null ? Math.round(p.openingAverage * 10000) / 10000 : null,
      closingAverage: p.closingAverage !== null ? Math.round(p.closingAverage * 10000) / 10000 : null,
      unstampedLines: p.unstamped,
    }))
    .filter(
      (l) =>
        Math.abs(l.cogsRecomputed - l.cogsStamped) >= 0.01 ||
        Math.abs(l.lossRecomputed - l.lossStamped) >= 0.01 ||
        Math.abs(l.productionRecomputed - l.productionStamped) >= 0.01 ||
        l.unstampedLines > 0,
    )
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.productName.localeCompare(b.productName, "ru"));
  return {
    year,
    month,
    status: meta.status,
    version: meta.version,
    computedAt: meta.computedAt.toISOString(),
    postedByName: meta.postedByName,
    cogsCorrection: result.cogsCorrection,
    lossCorrection: result.lossCorrection,
    totalCorrection: round2(result.cogsCorrection + result.lossCorrection),
    unstampedLines: result.unstampedLines,
    lines,
  };
}
