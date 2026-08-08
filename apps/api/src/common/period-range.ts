// The first genuinely new shared date-range utility in the codebase — every
// existing module (Finance, Sales, Quality, HR) accepts its own from/to and
// filters independently; none of them compare one period against the one
// before it. AI-центр is the first consumer that needs "vs previous period"
// as a first-class operation, so it lives here rather than duplicated per
// insight.

export interface PeriodRange {
  from: Date;
  to: Date;
}

export interface PeriodComparison {
  current: PeriodRange;
  previous: PeriodRange;
}

// Rolling windows, not calendar months — a partial current calendar month
// would otherwise skew every delta% low. `days` is inclusive of "today".
export function currentAndPreviousPeriod(days: number, endingAt: Date = new Date()): PeriodComparison {
  const to = endingAt;
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);

  const previousTo = new Date(from);
  previousTo.setMilliseconds(previousTo.getMilliseconds() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - (days - 1));
  previousFrom.setHours(0, 0, 0, 0);

  return { current: { from, to }, previous: { from: previousFrom, to: previousTo } };
}

// Null instead of a number when the previous period has no baseline
// (previous === 0) — reporting "+∞%" or silently treating it as 0% would
// both be misleading. Callers must render "нет данных для сравнения".
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
