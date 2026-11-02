import { movingAverageAfterPurchase } from "@bakery-os/shared";
import { round2 } from "../../common/money";

// Month-end cost correction, method «Б» (the owner's decision, 03.11.2026):
// during the month a product's average moves after every priced receipt and
// every outflow is stamped with the average of that moment. At close the whole
// history is walked again DAY BY DAY in document-date order — corrected and
// late documents in their place, finished goods valued at what their batches
// really cost — and every outflow of the month is valued again. What differs
// from the stamp is the correction. One average for the whole network: a
// transfer between points changes nothing and is not walked.
//
// Pure: no database, no clock. The service turns rows into flows.

export type OutCategory = "COGS" | "LOSS" | "PRODUCTION" | "NONE";

export type CostFlow =
  // A priced receipt (purchase order line as corrected, invoice, Склад → Приёмка
  // with a price): moves the average.
  | { kind: "PURCHASE"; at: number; order: number; productId: string; quantity: number; unitCost: number }
  // Stock that arrives at the average and leaves it alone: a restocked return
  // (category COGS — it reverses cost of goods), a count surplus (LOSS — it
  // reduces losses), a receipt without a price (NONE).
  | { kind: "IN"; at: number; order: number; productId: string; quantity: number; stampedUnitCost: number | null; category: OutCategory }
  // Stock that leaves at the average: a sale (COGS), a write-off or shortage
  // (LOSS), consumption by a production batch (PRODUCTION, internal).
  | { kind: "OUT"; at: number; order: number; productId: string; quantity: number; stampedUnitCost: number | null; category: OutCategory; batchId?: string }
  // What a batch produced: worth what its consumption is worth NOW, plus the
  // part of its cost that never was stock (an untracked ingredient like water).
  | { kind: "OUTPUT"; at: number; order: number; productId: string; quantity: number; stampedUnitCost: number | null; batchId: string };

export interface ReplayInput {
  flows: CostFlow[];
  // Per batch: the part of its stamped cost not carried by tracked consumption.
  batchUntracked: Map<string, number>;
  // A product's value per unit while no average is known yet (stock that came
  // in without a price before its first priced receipt): its first stamped
  // average, else its card price — what the live system used.
  startingAverage?: Map<string, number>;
  from: number;
  to: number;
}

export interface CategoryFigures {
  stamped: number;
  recomputed: number;
}

export interface ProductCorrection {
  productId: string;
  cogs: CategoryFigures;
  losses: CategoryFigures;
  production: CategoryFigures;
  quantityOut: number;
  // Outflows in the month with no stamped cost: left out of the correction.
  unstamped: number;
  openingAverage: number | null;
  closingAverage: number | null;
  closingQuantity: number;
}

export interface ReplayResult {
  products: ProductCorrection[];
  // Positive = more expense than was booked.
  cogsCorrection: number;
  lossCorrection: number;
  unstampedLines: number;
}

// Within one moment, a batch's consumption is valued before its output.
const KIND_ORDER: Record<CostFlow["kind"], number> = { PURCHASE: 1, IN: 2, OUT: 3, OUTPUT: 4 };
const productionFirst = (f: CostFlow) => (f.kind === "OUT" && f.category === "PRODUCTION" ? 0 : KIND_ORDER[f.kind]);

export function sortFlows(flows: CostFlow[]): CostFlow[] {
  return [...flows].sort((a, b) => a.at - b.at || productionFirst(a) - productionFirst(b) || a.order - b.order);
}

export function replayCosts(input: ReplayInput): ReplayResult {
  const state = new Map<string, { quantity: number; average: number | null }>();
  const result = new Map<string, ProductCorrection>();
  const batchValue = new Map<string, number>();
  const stateOf = (id: string) => {
    let s = state.get(id);
    if (!s) {
      s = { quantity: 0, average: null };
      state.set(id, s);
    }
    return s;
  };
  // Stock already on the shelf with no known value yet counts at the starting average.
  const knownAverage = (id: string, s: { quantity: number; average: number | null }, fallback: number | null) =>
    s.average ?? (s.quantity > 0 ? input.startingAverage?.get(id) ?? null : null) ?? fallback;
  const rowOf = (id: string) => {
    let r = result.get(id);
    if (!r) {
      const s = stateOf(id);
      r = {
        productId: id,
        cogs: { stamped: 0, recomputed: 0 },
        losses: { stamped: 0, recomputed: 0 },
        production: { stamped: 0, recomputed: 0 },
        quantityOut: 0,
        unstamped: 0,
        openingAverage: s.average,
        closingAverage: null,
        closingQuantity: 0,
      };
      result.set(id, r);
    }
    return r;
  };
  const figuresOf = (row: ProductCorrection, category: OutCategory): CategoryFigures | null =>
    category === "COGS" ? row.cogs : category === "LOSS" ? row.losses : category === "PRODUCTION" ? row.production : null;

  for (const flow of sortFlows(input.flows)) {
    if (flow.at > input.to) break;
    const inMonth = flow.at >= input.from;
    const s = stateOf(flow.productId);
    if (inMonth) rowOf(flow.productId);

    if (flow.kind === "PURCHASE") {
      s.average = movingAverageAfterPurchase(s.quantity, knownAverage(flow.productId, s, flow.unitCost)!, flow.quantity, flow.unitCost);
      s.quantity += flow.quantity;
      continue;
    }

    if (flow.kind === "OUTPUT") {
      const consumed = batchValue.get(flow.batchId);
      const untracked = input.batchUntracked.get(flow.batchId) ?? 0;
      const unit =
        consumed !== undefined && flow.quantity > 0 ? (consumed + untracked) / flow.quantity : flow.stampedUnitCost;
      if (unit !== null) {
        s.average = movingAverageAfterPurchase(s.quantity, knownAverage(flow.productId, s, unit)!, flow.quantity, unit);
      }
      s.quantity += flow.quantity;
      continue;
    }

    // IN or OUT at the average of this moment; with no average yet, the stamp
    // is the best knowledge there is (and then nothing is corrected).
    if (s.average === null) s.average = flow.stampedUnitCost ?? input.startingAverage?.get(flow.productId) ?? null;
    const unit = s.average ?? flow.stampedUnitCost;
    const recomputed = unit !== null ? round2(flow.quantity * unit) : null;
    const stamped = flow.stampedUnitCost !== null ? round2(flow.quantity * flow.stampedUnitCost) : null;

    if (flow.kind === "OUT") {
      s.quantity -= flow.quantity;
      if (flow.category === "PRODUCTION" && flow.batchId) {
        batchValue.set(flow.batchId, (batchValue.get(flow.batchId) ?? 0) + (recomputed ?? stamped ?? 0));
      }
    } else {
      s.quantity += flow.quantity;
    }

    if (!inMonth) continue;
    const row = rowOf(flow.productId);
    if (flow.kind === "OUT") row.quantityOut += flow.quantity;
    const figures = figuresOf(row, flow.category);
    if (!figures) continue;
    if (stamped === null || recomputed === null) {
      row.unstamped += 1;
      continue;
    }
    // An inflow (a restocked return, a surplus) reduces the cost it belongs to.
    const sign = flow.kind === "OUT" ? 1 : -1;
    figures.stamped += sign * stamped;
    figures.recomputed += sign * recomputed;
  }

  let cogsCorrection = 0;
  let lossCorrection = 0;
  let unstampedLines = 0;
  const products: ProductCorrection[] = [];
  for (const row of result.values()) {
    const s = stateOf(row.productId);
    for (const f of [row.cogs, row.losses, row.production]) {
      f.stamped = round2(f.stamped);
      f.recomputed = round2(f.recomputed);
    }
    row.quantityOut = Math.round(row.quantityOut * 1000) / 1000;
    row.closingAverage = s.average;
    row.closingQuantity = Math.round(s.quantity * 1000) / 1000;
    cogsCorrection += row.cogs.recomputed - row.cogs.stamped;
    lossCorrection += row.losses.recomputed - row.losses.stamped;
    unstampedLines += row.unstamped;
    products.push(row);
  }
  return { products, cogsCorrection: round2(cogsCorrection), lossCorrection: round2(lossCorrection), unstampedLines };
}
