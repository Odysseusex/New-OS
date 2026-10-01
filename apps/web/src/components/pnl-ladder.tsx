import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import {
  NET_PROFIT_STATUS_LABELS_RU,
  NOT_CONFIGURED_ITEM_LABELS_RU,
  NetProfitStatus,
} from "@bakery-os/shared";
import type { ProfitAndLossDto } from "@bakery-os/shared";
import { formatMoney } from "@/lib/format";

// The P&L as one ladder, top to bottom, in the order the figures are derived.
// Operating profit is shown as such and is never the last line: other results,
// income tax and net profit follow it, and net profit says when it is not final.
// A deduction shown as a negative — but never "−0".
const neg = (v: number): number => (v === 0 ? 0 : -v);

export function PnlLadder({ pnl }: { pnl: ProfitAndLossDto }) {
  const rows: { label: string; value: number | null; kind?: "sub" | "total" | "minus"; note?: string }[] = [
    { label: "Валовая выручка", value: pnl.grossRevenue },
    { label: "Скидки", value: neg(pnl.discountsTotal), kind: "minus" },
    { label: "Возвраты", value: neg(pnl.returnsTotal), kind: "minus" },
    { label: "Чистая выручка", value: pnl.netRevenue, kind: "total" },
    { label: "Себестоимость", value: neg(pnl.cogs), kind: "minus" },
    {
      label: `Валовая прибыль${pnl.grossMarginPercent != null ? ` (${pnl.grossMarginPercent.toFixed(0)}%)` : ""}`,
      value: pnl.grossProfit,
      kind: "total",
    },
    { label: "Потери по запасам", value: neg(pnl.inventoryLosses), kind: "minus" },
    { label: "Операционные расходы", value: neg(pnl.expensesTotal), kind: "minus" },
    { label: "Амортизация", value: neg(pnl.depreciation), kind: "minus" },
    { label: "Операционная прибыль", value: pnl.operatingProfit, kind: "total" },
    { label: "Прочие доходы и расходы", value: pnl.otherResult },
    { label: "Прибыль до налогообложения", value: pnl.profitBeforeTax, kind: "total" },
    { label: "Налог на прибыль", value: pnl.incomeTax === null ? null : neg(pnl.incomeTax), kind: "minus" },
    {
      label: `Чистая прибыль — ${NET_PROFIT_STATUS_LABELS_RU[pnl.netProfitStatus].toLowerCase()}`,
      value: pnl.netProfit,
      kind: "total",
    },
  ];

  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label} className={clsx(row.kind === "total" && "bg-surface-muted")}>
              <td
                className={clsx(
                  "px-5 py-2.5",
                  row.kind === "total" ? "font-semibold text-foreground" : "text-muted",
                  row.kind === "minus" && "pl-9",
                )}
              >
                {row.label}
              </td>
              <td
                className={clsx(
                  "px-5 py-2.5 text-right tabular-nums",
                  row.kind === "total" ? "font-semibold text-foreground" : "text-foreground",
                  row.value !== null && row.value < 0 && row.kind === "total" && "text-red-700",
                )}
              >
                {row.value === null ? "не настроен" : formatMoney(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(pnl.notConfigured.length > 0 || pnl.costCoverage.fallbackLines > 0 || pnl.unknownCostLossItems > 0 || pnl.unclassifiedExpensesTotal > 0) && (
        <div className="space-y-1 border-t border-border px-5 py-3 text-xs text-amber-800">
          {pnl.netProfitStatus === NetProfitStatus.PRELIMINARY &&
            pnl.notConfigured.map((item) => (
              <div key={item} className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                {NOT_CONFIGURED_ITEM_LABELS_RU[item]}
              </div>
            ))}
          {pnl.costCoverage.fallbackLines > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              Строк без зафиксированной себестоимости (по текущим ценам): {pnl.costCoverage.fallbackLines}
            </div>
          )}
          {pnl.unclassifiedExpensesTotal > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              Расходы без классификации (учтены как операционные): {formatMoney(pnl.unclassifiedExpensesTotal)}
            </div>
          )}
          {pnl.unknownCostLossItems > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              Списаний и корректировок без себестоимости: {pnl.unknownCostLossItems}
            </div>
          )}
        </div>
      )}
      {pnl.capitalizedExpensesTotal > 0 && (
        <div className="border-t border-border px-5 py-2 text-xs text-muted">
          Капитализировано (не входит в расходы): {formatMoney(pnl.capitalizedExpensesTotal)}
        </div>
      )}
      <div className="border-t border-border px-5 py-2 text-xs text-muted">Оценка запасов: {pnl.costingMethod}</div>
    </div>
  );
}
