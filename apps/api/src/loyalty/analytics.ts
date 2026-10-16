import {
  LOYALTY_SEGMENTS,
  LoyaltyAnalyticsDto,
  LoyaltyAnalyticsMemberRowDto,
  LoyaltyChurnSettings,
  LoyaltySegment,
  RFM_SEGMENT_CODES,
} from "@bakery-os/shared";

// Pure arithmetic for the customer-analytics screen — no database here, so each
// definition is tested on its own. A «visit» is one sale with the member attached;
// its amount is our own money (consignment goods and returns already taken off).

export interface AnalyticsVisit {
  memberId: string;
  at: Date;
  amount: number;
}

export interface AnalyticsMember {
  id: string;
  phone: string;
  name: string | null;
  // Withdrawn consent: still counted in figures, never offered for contact.
  contactable: boolean;
}

export interface AnalyticsInput {
  from: Date;
  to: Date;
  visits: AnalyticsVisit[];
  members: Map<string, AnalyticsMember>;
  anonymous: { visits: number; revenue: number };
  churn: LoyaltyChurnSettings;
  // "YYYY-MM-DD" on the reporting wall clock (Asia/Almaty).
  dateKey: (date: Date) => string;
}

export const RFM_WINDOW_DAYS = 365;
export const RFM_MINIMUM_MEMBERS = 30;
const DAY = 86_400_000;
const round2 = (v: number) => Math.round(v * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const FREQUENCY_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "1", min: 1, max: 1 },
  { label: "2", min: 2, max: 2 },
  { label: "3–4", min: 3, max: 4 },
  { label: "5–9", min: 5, max: 9 },
  { label: "10+", min: 10, max: Infinity },
];

const SEGMENT_BY_CODE = new Map<string, LoyaltySegment>(
  LOYALTY_SEGMENTS.flatMap((s) => RFM_SEGMENT_CODES[s].map((code) => [code, s] as const)),
);

// Percentile score 1..3: the share of others strictly below decides the third.
function tertileScores(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const below = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return values.map((v) => {
    const p = below(v) / values.length;
    return p < 1 / 3 ? 1 : p < 2 / 3 ? 2 : 3;
  });
}

export function rfmSegment(r: number, f: number, m: number): LoyaltySegment {
  return SEGMENT_BY_CODE.get(`${r}${f}${m}`) ?? LoyaltySegment.NEEDS_ATTENTION;
}

function mondayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const weekday = (new Date(utc).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(utc - weekday * DAY).toISOString().slice(0, 10);
}

function monthIndex(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
}

const monthKeyOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export function computeLoyaltyAnalytics(input: AnalyticsInput): LoyaltyAnalyticsDto {
  const { from, to, members, churn, dateKey } = input;
  const visits = input.visits.filter((v) => v.at <= to && members.has(v.memberId)).sort((a, b) => a.at.getTime() - b.at.getTime());

  const byMember = new Map<string, AnalyticsVisit[]>();
  for (const v of visits) {
    const list = byMember.get(v.memberId) ?? [];
    list.push(v);
    byMember.set(v.memberId, list);
  }
  const firstVisit = new Map([...byMember].map(([id, list]) => [id, list[0].at]));
  const inPeriod = (v: AnalyticsVisit) => v.at >= from && v.at <= to;

  const row = (memberId: string, list: AnalyticsVisit[], segment: LoyaltySegment | null = null): LoyaltyAnalyticsMemberRowDto => {
    const member = members.get(memberId)!;
    const all = byMember.get(memberId)!;
    const last = all[all.length - 1].at;
    const spend = round2(list.reduce((s, v) => s + v.amount, 0));
    return {
      memberId,
      phone: member.phone,
      name: member.name,
      lastVisitAt: last.toISOString(),
      daysSinceLastVisit: Math.floor((to.getTime() - last.getTime()) / DAY),
      visits: list.length,
      spend,
      averageCheck: list.length ? round2(spend / list.length) : 0,
      usualIntervalDays: all.length >= 2 ? round2((last.getTime() - all[0].at.getTime()) / DAY / (all.length - 1)) : null,
      segment,
    };
  };

  // ── summary ────────────────────────────────────────────────────────────
  const periodVisits = visits.filter(inPeriod);
  const periodByMember = new Map<string, AnalyticsVisit[]>();
  for (const v of periodVisits) periodByMember.set(v.memberId, [...(periodByMember.get(v.memberId) ?? []), v]);
  const active = [...periodByMember.keys()];
  const newMembers = active.filter((id) => firstVisit.get(id)! >= from).length;
  const returning = active.filter((id) => (byMember.get(id)?.length ?? 0) >= 2).length;
  const memberRevenue = round2(periodVisits.reduce((s, v) => s + v.amount, 0));

  // ── RFM segments (as of `to`, over the last year) ───────────────────────
  const rfmFrom = new Date(to.getTime() - RFM_WINDOW_DAYS * DAY);
  const scored = [...byMember]
    .map(([id, list]) => ({ id, window: list.filter((v) => v.at >= rfmFrom) }))
    .filter((m) => m.window.length > 0);
  const available = scored.length >= RFM_MINIMUM_MEMBERS;
  const segmentOf = new Map<string, LoyaltySegment>();
  if (available) {
    const r = tertileScores(scored.map((m) => m.window[m.window.length - 1].at.getTime()));
    const f = tertileScores(scored.map((m) => m.window.length));
    const mo = tertileScores(scored.map((m) => m.window.reduce((s, v) => s + v.amount, 0)));
    scored.forEach((m, i) => segmentOf.set(m.id, rfmSegment(r[i], f[i], mo[i])));
  }
  const segmentRows = available
    ? scored.map((m) => row(m.id, m.window, segmentOf.get(m.id)!)).sort((a, b) => b.spend - a.spend)
    : [];

  // ── churn radar: regulars who stopped coming ───────────────────────────
  const windowStart = new Date(to.getTime() - churn.windowDays * DAY);
  const quietSince = new Date(to.getTime() - churn.inactiveDays * DAY);
  const radar = [...byMember]
    .filter(([id, list]) => {
      if (!members.get(id)!.contactable) return false;
      const last = list[list.length - 1].at;
      return last < quietSince && list.filter((v) => v.at >= windowStart).length >= churn.minVisits;
    })
    .map(([id, list]) => row(id, list.filter((v) => v.at >= windowStart), segmentOf.get(id) ?? null))
    .sort((a, b) => b.spend - a.spend);

  // ── visit frequency in the period ──────────────────────────────────────
  const frequency = FREQUENCY_BUCKETS.map((b) => ({
    label: b.label,
    members: [...periodByMember.values()].filter((list) => list.length >= b.min && list.length <= b.max).length,
  }));

  // ── new vs returning members per week ──────────────────────────────────
  const weeks = new Map<string, { newSet: Set<string>; returningSet: Set<string> }>();
  for (let t = from.getTime(); t <= to.getTime() + DAY; t += 7 * DAY) {
    const key = mondayKey(dateKey(new Date(Math.min(t, to.getTime()))));
    if (!weeks.has(key)) weeks.set(key, { newSet: new Set(), returningSet: new Set() });
  }
  for (const v of periodVisits) {
    const key = mondayKey(dateKey(v.at));
    const week = weeks.get(key) ?? { newSet: new Set<string>(), returningSet: new Set<string>() };
    weeks.set(key, week);
    const first = firstVisit.get(v.memberId)!;
    if (mondayKey(dateKey(first)) === key) week.newSet.add(v.memberId);
    else week.returningSet.add(v.memberId);
  }
  for (const w of weeks.values()) for (const id of w.newSet) w.returningSet.delete(id);
  const weekly = [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => ({ weekStart, newMembers: w.newSet.size, returningMembers: w.returningSet.size }));

  // ── monthly cohorts: of those who first came in a month, who came back ──
  const currentMonth = monthIndex(dateKey(to));
  const monthsOf = new Map([...byMember].map(([id, list]) => [id, new Set(list.map((v) => monthIndex(dateKey(v.at))))]));
  const cohorts = [];
  for (let m = currentMonth - 5; m <= currentMonth; m += 1) {
    const ids = [...firstVisit].filter(([, at]) => monthIndex(dateKey(at)) === m).map(([id]) => id);
    if (ids.length === 0) continue;
    cohorts.push({
      month: monthKeyOf(m),
      size: ids.length,
      retention: [1, 2, 3].map((k) => (m + k > currentMonth ? null : ids.filter((id) => monthsOf.get(id)!.has(m + k)).length / ids.length)),
    });
  }

  const topMembers = [...periodByMember]
    .map(([id, list]) => row(id, list, segmentOf.get(id) ?? null))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    summary: {
      activeMembers: active.length,
      newMembers,
      returningShare: ratio(returning, active.length),
      averageCheckMembers: periodVisits.length ? round2(memberRevenue / periodVisits.length) : null,
      averageCheckAnonymous: input.anonymous.visits ? round2(input.anonymous.revenue / input.anonymous.visits) : null,
      visitsPerMember: active.length ? round2(periodVisits.length / active.length) : null,
      memberRevenueShare: ratio(memberRevenue, memberRevenue + input.anonymous.revenue),
      memberRevenue,
      memberVisits: periodVisits.length,
    },
    segments: {
      minimumMembers: RFM_MINIMUM_MEMBERS,
      membersScored: scored.length,
      available,
      groups: LOYALTY_SEGMENTS.map((segment) => {
        const rows = segmentRows.filter((r) => r.segment === segment);
        return { segment, members: rows.length, revenue: round2(rows.reduce((s, r) => s + r.spend, 0)) };
      }),
      rows: segmentRows,
    },
    churnRadar: { ...churn, rows: radar },
    frequency,
    weekly,
    cohorts,
    topMembers,
  };
}
