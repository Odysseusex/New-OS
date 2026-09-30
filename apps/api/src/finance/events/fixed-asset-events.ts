import { BalanceLine, FinancialEvent, FinancialEventType, PnlLine } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { round2 } from "../../common/money";
import { monthRange } from "../../common/reporting-period";
import type { ProjectionOptions } from "./projector";

// Fixed assets, on the accrual side:
//   depreciation  Fixed assets ↓, Depreciation (P&L) ↓ — dated the last instant of its month
//   disposal      Fixed assets ↓ by (book value − proceeds), result = proceeds − book value
// The proceeds themselves are a cash event (cash-events.ts: cash ↑, Fixed
// assets ↓ by the proceeds), so together the asset leaves the books at its
// book value with no amount counted twice.

export async function fixedAssetEvents(
  prisma: PrismaService,
  organizationId: string,
  opts: ProjectionOptions,
): Promise<FinancialEvent[]> {
  const [entries, disposals] = await Promise.all([
    prisma.depreciationEntry.findMany({ where: { organizationId }, include: { asset: { select: { name: true } } } }),
    prisma.fixedAsset.findMany({ where: { organizationId, status: "DISPOSED", disposedAt: { not: null } } }),
  ]);
  const events: FinancialEvent[] = [];
  const upTo = opts.upTo?.toISOString();

  for (const e of entries) {
    const occurredAt = monthRange(e.year, e.month).end.toISOString();
    if (upTo && occurredAt > upTo) continue;
    const amount = round2(e.amount.toNumber());
    events.push({
      key: `depreciation:${e.id}`,
      type: FinancialEventType.DEPRECIATION,
      occurredAt,
      sourceType: "DepreciationEntry",
      sourceId: e.id,
      description: `Амортизация: ${e.asset.name}`,
      cash: [],
      balance: [{ line: BalanceLine.FIXED_ASSETS, delta: -amount }],
      pnl: [{ line: PnlLine.DEPRECIATION, amount: -amount }],
      unclassified: false,
    });
  }

  for (const a of disposals) {
    const occurredAt = a.disposedAt!.toISOString();
    if (upTo && occurredAt > upTo) continue;
    const bookValue = round2(a.disposalBookValue?.toNumber() ?? 0);
    const proceeds = round2(a.disposalProceeds?.toNumber() ?? 0);
    const result = round2(proceeds - bookValue);
    events.push({
      key: `fixedAsset:${a.id}:disposal`,
      type: FinancialEventType.ASSET_DISPOSAL,
      occurredAt,
      sourceType: "FixedAsset",
      sourceId: a.id,
      description: `Выбытие основного средства: ${a.name}`,
      cash: [],
      balance: bookValue - proceeds !== 0 ? [{ line: BalanceLine.FIXED_ASSETS, delta: -round2(bookValue - proceeds) }] : [],
      pnl:
        result === 0
          ? []
          : [{ line: result > 0 ? PnlLine.OTHER_INCOME : PnlLine.OTHER_EXPENSE, amount: result }],
      unclassified: false,
    });
  }
  return events;
}
