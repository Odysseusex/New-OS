import { convertUnitQuantity, getCompatibleUnits, ProductType, Unit } from "./catalog";

export enum StocktakeStatus {
  COUNTING = "COUNTING",
  REVIEW = "REVIEW",
  APPROVED = "APPROVED",
  CANCELLED = "CANCELLED",
}

export const STOCKTAKE_STATUS_LABELS_RU: Record<StocktakeStatus, string> = {
  [StocktakeStatus.COUNTING]: "Подсчёт",
  [StocktakeStatus.REVIEW]: "На проверке",
  [StocktakeStatus.APPROVED]: "Проведена",
  [StocktakeStatus.CANCELLED]: "Отменена",
};

export interface StocktakeLineDto {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: Unit;
  categoryName: string | null;
  // null in a blind count (see StocktakeDto.blind).
  systemQuantity: number | null;
  countedQuantity: number | null;
  // countedQuantity − systemQuantity; null while not counted (or blind).
  difference: number | null;
  // Current unit cost from the costing service (null = no cost data); the
  // value is indicative until approval fixes it on the adjustment movement.
  unitCost: number | null;
  differenceValue: number | null;
  note: string | null;
  movementId: string | null;
}

export interface StocktakeSummaryDto {
  id: string;
  locationId: string;
  locationName: string;
  status: StocktakeStatus;
  note: string | null;
  snapshotAt: string;
  createdByName: string;
  approvedAt: string | null;
  approvedByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lineCount: number;
  countedCount: number;
}

export interface StocktakeDto extends StocktakeSummaryDto {
  lines: StocktakeLineDto[];
  shortageValue: number;
  surplusValue: number;
  // Lines whose snapshot disagreed with the movement ledger at creation —
  // the count does not hide it; the integrity diagnostic keeps reporting it.
  snapshotDriftCount: number;
  // A blind count: while it is being counted, whoever counts (anyone who cannot
  // approve) is not told what the books say, so nobody fits the count to them.
  // Quantities by the books, differences and their value are withheld until review.
  blind: boolean;
}

export interface CreateStocktakeRequestDto {
  locationId: string;
  categoryId?: string;
  // Only products of this type (e.g. raw materials for a warehouse count).
  productType?: ProductType;
  note?: string;
}

export interface UpdateStocktakeLineRequestDto {
  countedQuantity: number | null;
  note?: string | null;
}

export interface CancelStocktakeRequestDto {
  reason: string;
}

// What a counter types, read as a quantity in the product's own unit: a plain
// number («12,5»), sums and products for sacks and boxes («3*25+12», «3х25»),
// and grams / millilitres for a product kept in kg / l («350г» → 0.35). Null
// when it is not a quantity — never guessed. No eval: only these characters.
const UNIT_SUFFIXES: [string, Unit][] = [
  ["кг", Unit.KG],
  ["гр", Unit.G],
  ["г", Unit.G],
  ["мл", Unit.ML],
  ["л", Unit.L],
  ["шт", Unit.PCS],
];

export function parseCountInput(text: string, unit: Unit): number | null {
  let s = text.trim().toLowerCase().replace(/\s+/g, "").replace(/,/g, ".").replace(/[×хx]/g, "*");
  if (s === "") return null;
  // A unit typed after the number: converted when it is of the same kind, refused otherwise.
  let typedUnit = unit;
  const suffix = UNIT_SUFFIXES.find(([text]) => s.endsWith(text));
  if (suffix) {
    s = s.slice(0, -suffix[0].length);
    typedUnit = suffix[1];
    if (!getCompatibleUnits(unit).includes(typedUnit)) return null;
  }
  if (!/^[0-9.+\-*]+$/.test(s)) return null;
  let total = 0;
  for (const term of s.match(/[+-]?[^+-]+/g) ?? []) {
    const sign = term.startsWith("-") ? -1 : 1;
    let product = 1;
    for (const factor of term.replace(/^[+-]/, "").split("*")) {
      if (!/^(\d+(\.\d*)?|\.\d+)$/.test(factor)) return null;
      product *= Number(factor);
    }
    total += sign * product;
  }
  const value = Math.round(convertUnitQuantity(total, typedUnit, unit) * 1000) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
