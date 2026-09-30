import { DepreciationMethod } from "@bakery-os/shared";
import { round2 } from "../common/money";

// What a calculator needs to know about an asset. Every field must be stated;
// a calculator is never handed a guessed value.
export interface DepreciableTerms {
  acquisitionCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  startYear: number;
  startMonth: number;
}

export interface ChargeContext {
  year: number;
  month: number;
  // Depreciation already posted for this asset (all months).
  accumulated: number;
}

// One entry per depreciation METHOD. Adding a method (declining balance, units
// of production…) means adding an entry here — nothing else changes. A method
// with no entry (NOT_DEPRECIATED) charges nothing.
export interface DepreciationCalculator {
  method: DepreciationMethod;
  monthlyCharge(terms: DepreciableTerms, ctx: ChargeContext): number;
}

const monthIndex = (year: number, month: number) => year * 12 + month;

// Straight-line: (cost − salvage) ÷ useful life, charged per month from the
// stated start month for exactly the useful life. Rounded to 2 dp; the last
// month absorbs the rounding remainder so the total is exactly cost − salvage.
// This is a CAPABILITY — it depreciates an asset only when someone has chosen
// it for that asset (or approved it as the policy); it is not a default.
export const straightLine: DepreciationCalculator = {
  method: DepreciationMethod.STRAIGHT_LINE,
  monthlyCharge(terms, ctx) {
    const position = monthIndex(ctx.year, ctx.month) - monthIndex(terms.startYear, terms.startMonth);
    if (position < 0 || position >= terms.usefulLifeMonths) return 0;
    const base = round2(terms.acquisitionCost - terms.salvageValue);
    if (base <= 0) return 0;
    const remaining = round2(base - ctx.accumulated);
    if (remaining <= 0) return 0;
    const isLast = position === terms.usefulLifeMonths - 1;
    const regular = round2(base / terms.usefulLifeMonths);
    return isLast ? remaining : Math.min(regular, remaining);
  },
};

const REGISTRY = new Map<DepreciationMethod, DepreciationCalculator>([[straightLine.method, straightLine]]);

export const depreciationCalculators = {
  get: (method: DepreciationMethod | null | undefined): DepreciationCalculator | null =>
    method ? (REGISTRY.get(method) ?? null) : null,
  register: (calculator: DepreciationCalculator) => REGISTRY.set(calculator.method, calculator),
  methods: (): DepreciationMethod[] => [...REGISTRY.keys()],
};

export interface AssetTermsInput {
  acquisitionCost: { toNumber: () => number };
  depreciationMethod: string | null;
  usefulLifeMonths: number | null;
  salvageValue: { toNumber: () => number } | null;
  depreciationStartYear: number | null;
  depreciationStartMonth: number | null;
}

// The terms an asset depreciates on, or null when it does not depreciate. The
// asset's own method wins; the policy's method applies only when it was
// APPROVED (never when merely "current behaviour"). Salvage value and start
// month have no policy — they must be stated on the asset itself.
export function resolveDepreciableTerms(
  asset: AssetTermsInput,
  policyMethod: DepreciationMethod | null,
  policyLife: number | null,
): (DepreciableTerms & { method: DepreciationMethod }) | null {
  const method = (asset.depreciationMethod as DepreciationMethod | null) ?? policyMethod;
  if (!method || method === DepreciationMethod.NOT_DEPRECIATED) return null;
  const life = asset.usefulLifeMonths ?? policyLife;
  if (
    !depreciationCalculators.get(method) ||
    !life ||
    asset.salvageValue === null ||
    !asset.depreciationStartYear ||
    !asset.depreciationStartMonth
  ) {
    return null;
  }
  return {
    method,
    acquisitionCost: asset.acquisitionCost.toNumber(),
    salvageValue: asset.salvageValue.toNumber(),
    usefulLifeMonths: life,
    startYear: asset.depreciationStartYear,
    startMonth: asset.depreciationStartMonth,
  };
}

export function isExplicitlyNotDepreciated(asset: { depreciationMethod: string | null }, policyMethod: DepreciationMethod | null): boolean {
  return ((asset.depreciationMethod as DepreciationMethod | null) ?? policyMethod) === DepreciationMethod.NOT_DEPRECIATED;
}
