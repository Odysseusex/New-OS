import { BalanceLine, FinancialEvent, FinancialEventType, PnlLine } from "@bakery-os/shared";
import { round2 } from "../../common/money";
import { monthRange } from "../../common/reporting-period";
import { scoped, type DbClient } from "./scope";
import type { ProjectionOptions } from "./projector";

// The month-end cost correction recorded at close (cost-correction/), one event
// per month — its LATEST version only: closing a reopened month again writes a
// new version, and the earlier one stops being an event (the ledger then
// reverses its entry). Dated at the last moment of the month, so it belongs to
// that month's figures. Cost of goods sold and losses move by the correction,
// inventory by the same amount the other way: nothing else is touched.
export async function costCorrectionEvents(prisma: DbClient, organizationId: string, opts: ProjectionOptions): Promise<FinancialEvent[]> {
  const ids = scoped(opts.scope, "costCorrectionIds");
  if (ids && ids.length === 0) return [];
  const rows = await prisma.costCorrection.findMany({
    where: { organizationId },
    select: { id: true, year: true, month: true, version: true, cogsAmount: true, lossAmount: true },
    orderBy: [{ year: "asc" }, { month: "asc" }, { version: "desc" }],
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const events: FinancialEvent[] = [];
  for (const r of latest.values()) {
    if (ids && !ids.includes(r.id)) continue;
    const at = monthRange(r.year, r.month).end;
    if (opts.upTo && at > opts.upTo) continue;
    const cogs = round2(r.cogsAmount.toNumber());
    const loss = round2(r.lossAmount.toNumber());
    if (cogs === 0 && loss === 0) continue;
    events.push({
      key: `costCorrection:${r.id}`,
      type: FinancialEventType.COST_CORRECTION,
      occurredAt: at.toISOString(),
      sourceType: "CostCorrection",
      sourceId: r.id,
      description: `Корректировка себестоимости за ${String(r.month).padStart(2, "0")}.${r.year}`,
      cash: [],
      balance: [{ line: BalanceLine.INVENTORY, delta: -round2(cogs + loss) }],
      pnl: [
        ...(cogs !== 0 ? [{ line: PnlLine.COGS, amount: -cogs }] : []),
        ...(loss !== 0 ? [{ line: PnlLine.INVENTORY_LOSS, amount: -loss }] : []),
      ],
      unclassified: false,
    });
  }
  return events;
}
