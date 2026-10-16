// Pure arithmetic over a member's points entries — no database here, so the
// expiry rules are tested on their own.
//
// Every positive entry is a lot with its own expiry date. A negative entry
// consumes lots earliest-expiring first: an EXPIRE entry consumes the lots that
// had expired when it was written, anything else (a purchase, a return, a
// correction) consumes lots still alive at that moment. Amounts are handled in
// whole тиын so no float noise accumulates.

export interface PointsRow {
  id: string;
  type: string;
  points: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface PointsLot {
  expiresAt: Date;
  remaining: number; // in points (₸), 2 decimals
}

export interface PointsPosition {
  // Usable now.
  available: number;
  // Expired but not yet written off by an EXPIRE entry.
  dueToExpire: number;
  // Lots still alive, earliest expiry first (what a merge carries over).
  liveLots: PointsLot[];
}

const tiyn = (value: number) => Math.round(value * 100);

export function pointsPosition(rows: PointsRow[], now: Date): PointsPosition {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const lots: { expiresAt: Date; remaining: number }[] = [];

  const consume = (amount: number, eligible: (lot: { expiresAt: Date }) => boolean) => {
    let left = amount;
    const candidates = lots.filter((l) => l.remaining > 0 && eligible(l)).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
    for (const lot of candidates) {
      if (left <= 0) break;
      const take = Math.min(lot.remaining, left);
      lot.remaining -= take;
      left -= take;
    }
    return left;
  };

  for (const row of ordered) {
    const amount = tiyn(row.points);
    if (amount > 0) {
      // A positive entry always carries an expiry (database CHECK).
      lots.push({ expiresAt: row.expiresAt ?? new Date(8.64e15), remaining: amount });
      continue;
    }
    const at = row.createdAt.getTime();
    let left =
      row.type === "EXPIRE"
        ? consume(-amount, (l) => l.expiresAt.getTime() <= at)
        : consume(-amount, (l) => l.expiresAt.getTime() > at);
    // Defensive: never leave a consumption unaccounted for.
    if (left > 0) left = consume(left, () => true);
  }

  const t = now.getTime();
  const live = lots.filter((l) => l.remaining > 0 && l.expiresAt.getTime() > t).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const due = lots.filter((l) => l.remaining > 0 && l.expiresAt.getTime() <= t).reduce((sum, l) => sum + l.remaining, 0);
  return {
    available: live.reduce((sum, l) => sum + l.remaining, 0) / 100,
    dueToExpire: due / 100,
    liveLots: live.map((l) => ({ expiresAt: l.expiresAt, remaining: l.remaining / 100 })),
  };
}

export function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}
