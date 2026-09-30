import { ReplenishmentStatus } from "@bakery-os/shared";

export interface ReplenishmentParams {
  leadTimeDays: number;
  safetyDays: number;
  reviewDays: number;
}

export interface ReplenishmentInput {
  onHand: number;
  onOrder: number;
  // Units sold per day, averaged over the look-back window (empty days counted).
  averageDailyDemand: number;
  currentMinQuantity: number;
}

export interface ReplenishmentResult {
  daysOfCover: number | null;
  suggestedMin: number;
  reorderPoint: number;
  suggestedMax: number;
  suggestedOrder: number;
  status: ReplenishmentStatus;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// Min/max reorder logic, all from stated parameters:
//   min           = demand × safety days               (the buffer that must not be touched)
//   reorder point = demand × (lead time + safety days) (order when stock + incoming falls to it)
//   max           = reorder point + demand × review days
//   order         = max − (on hand + on order), never negative
export function planReplenishment(input: ReplenishmentInput, p: ReplenishmentParams): ReplenishmentResult {
  const d = input.averageDailyDemand;
  if (d <= 0) {
    return { daysOfCover: null, suggestedMin: 0, reorderPoint: 0, suggestedMax: 0, suggestedOrder: 0, status: "NO_DEMAND" };
  }
  const suggestedMin = d * p.safetyDays;
  const reorderPoint = d * (p.leadTimeDays + p.safetyDays);
  const suggestedMax = reorderPoint + d * p.reviewDays;
  const position = input.onHand + input.onOrder;
  const suggestedOrder = Math.max(0, suggestedMax - position);
  const status: ReplenishmentStatus = input.onHand <= suggestedMin ? "BELOW_MIN" : position <= reorderPoint ? "REORDER" : "OK";
  return {
    daysOfCover: r3(input.onHand / d),
    suggestedMin: r3(suggestedMin),
    reorderPoint: r3(reorderPoint),
    suggestedMax: r3(suggestedMax),
    suggestedOrder: r3(suggestedOrder),
    status,
  };
}
