import { AbcClass, XyzClass } from "@bakery-os/shared";

// Methodology thresholds, not accounting policy: the classic 80/15/5 revenue
// split for ABC and the classic 10% / 25% coefficient-of-variation cut-offs for
// XYZ. They are parameters of the analysis and are returned with its result.
export const ABC_XYZ_DEFAULTS = { aShare: 80, bShare: 95, xCv: 10, yCv: 25, minWeeks: 4 };

export interface AbcInput {
  id: string;
  revenue: number;
}

// Products sorted by revenue; class A until cumulative share reaches aShare, B
// until bShare, C for the rest. A product with no revenue is C. Ties broken by id
// so the same data always gives the same classes.
export function classifyAbc<T extends AbcInput>(
  items: T[],
  aShare = ABC_XYZ_DEFAULTS.aShare,
  bShare = ABC_XYZ_DEFAULTS.bShare,
): (T & { share: number; cumulativeShare: number; abcClass: AbcClass })[] {
  const total = items.reduce((s, i) => s + Math.max(0, i.revenue), 0);
  const sorted = [...items].sort((a, b) => b.revenue - a.revenue || (a.id < b.id ? -1 : 1));
  let cumulative = 0;
  return sorted.map((item) => {
    const before = cumulative;
    const share = total > 0 ? (Math.max(0, item.revenue) / total) * 100 : 0;
    cumulative += share;
    // A product belongs to the class in which its share STARTS: the one that
    // carries the cumulative line across a threshold still belongs to that class.
    const abcClass: AbcClass = item.revenue <= 0 ? "C" : before < aShare ? "A" : before < bShare ? "B" : "C";
    return { ...item, share: round1(share), cumulativeShare: round1(Math.min(100, cumulative)), abcClass };
  });
}

// Coefficient of variation (population standard deviation ÷ mean, in %) of the
// weekly demand series. Weeks are ALL the weeks of the window including zeros —
// a product that sells in bursts is unstable, and dropping its empty weeks
// would hide exactly that.
export function coefficientOfVariation(weekly: number[]): number | null {
  if (weekly.length === 0) return null;
  const mean = weekly.reduce((s, v) => s + v, 0) / weekly.length;
  if (mean <= 0) return null;
  const variance = weekly.reduce((s, v) => s + (v - mean) ** 2, 0) / weekly.length;
  return (Math.sqrt(variance) / mean) * 100;
}

export function classifyXyz(cv: number | null, weeksWithSales: number): XyzClass | null {
  if (cv === null || weeksWithSales < ABC_XYZ_DEFAULTS.minWeeks) return null;
  if (cv <= ABC_XYZ_DEFAULTS.xCv) return "X";
  if (cv <= ABC_XYZ_DEFAULTS.yCv) return "Y";
  return "Z";
}

const round1 = (v: number) => Math.round(v * 10) / 10;
