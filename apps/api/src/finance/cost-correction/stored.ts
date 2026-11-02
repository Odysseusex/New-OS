import type { CostCorrectionLineDto } from "@bakery-os/shared";
import { round2 } from "../../common/money";
import { monthRange } from "../../common/reporting-period";
import type { DbClient } from "../events/scope";

export interface StoredCorrection {
  id: string;
  year: number;
  month: number;
  version: number;
  cogsAmount: number;
  lossAmount: number;
  lines: CostCorrectionLineDto[];
}

// The month-end cost corrections that count inside [from, to]: the latest
// version of each month whose last moment falls in the range — the same rule
// the event projection follows (cost-correction-events.ts), so the P&L read
// from documents and the one read from events agree to the тиын.
export async function correctionsInRange(prisma: DbClient, organizationId: string, from: Date, to: Date): Promise<StoredCorrection[]> {
  const rows = await prisma.costCorrection.findMany({
    where: { organizationId, year: { gte: from.getUTCFullYear() - 1, lte: to.getUTCFullYear() + 1 } },
    orderBy: [{ year: "asc" }, { month: "asc" }, { version: "desc" }],
  });
  const seen = new Set<string>();
  const out: StoredCorrection[] = [];
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = monthRange(r.year, r.month).end;
    if (at < from || at > to) continue;
    out.push({
      id: r.id,
      year: r.year,
      month: r.month,
      version: r.version,
      cogsAmount: round2(r.cogsAmount.toNumber()),
      lossAmount: round2(r.lossAmount.toNumber()),
      lines: r.lines as unknown as CostCorrectionLineDto[],
    });
  }
  return out;
}

export const cogsDeltaOf = (l: CostCorrectionLineDto) => round2(l.cogsRecomputed - l.cogsStamped);
export const lossDeltaOf = (l: CostCorrectionLineDto) => round2(l.lossRecomputed - l.lossStamped);
