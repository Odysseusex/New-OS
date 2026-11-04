"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { FileDown, FileText } from "lucide-react";
import type { PnlByLocationDto, PnlFiguresDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { periodLabel, periodRange, type PeriodValue } from "@/lib/period";
import { formatMoney } from "@/lib/format";
import { downloadTable, withExportTarget } from "@/lib/export-table";

const neg = (v: number) => (v === 0 ? 0 : -v);
const ebitda = (f: PnlFiguresDto) => f.operatingProfit + f.depreciation;
const netMargin = (f: PnlFiguresDto) => (f.netRevenue > 0 ? (f.netProfit / f.netRevenue) * 100 : null);

type Line = { label: string; value: (f: PnlFiguresDto) => number | null; percent?: boolean; strong?: boolean; minus?: boolean };

const LINES: Line[] = [
  { label: "Валовая выручка", value: (f) => f.grossRevenue },
  { label: "Скидки", value: (f) => neg(f.discountsTotal), minus: true },
  { label: "Возвраты", value: (f) => neg(f.returnsTotal), minus: true },
  { label: "Чистая выручка", value: (f) => f.netRevenue, strong: true },
  { label: "Себестоимость", value: (f) => neg(f.cogs), minus: true },
  { label: "Валовая прибыль", value: (f) => f.grossProfit, strong: true },
  { label: "Валовая маржа", value: (f) => f.grossMarginPercent, percent: true },
  { label: "Потери по запасам", value: (f) => neg(f.inventoryLosses), minus: true },
  { label: "Операционные расходы", value: (f) => neg(f.expensesTotal), minus: true },
  { label: "EBITDA", value: ebitda, strong: true },
  { label: "Амортизация", value: (f) => neg(f.depreciation), minus: true },
  { label: "Операционная прибыль (EBIT)", value: (f) => f.operatingProfit, strong: true },
  { label: "Прочие доходы и расходы", value: (f) => f.otherResult },
  { label: "Прибыль до налогообложения", value: (f) => f.profitBeforeTax, strong: true },
  { label: "Налог на прибыль", value: (f) => (f.incomeTax === null ? null : neg(f.incomeTax)), minus: true },
  { label: "Чистая прибыль", value: (f) => f.netProfit, strong: true },
  { label: "Рентабельность по чистой прибыли", value: netMargin, percent: true },
];

// Финансы → P&L → «ОПиУ по точкам»: every point's own P&L side by side with «Итого».
export function LocationPnlCard({ period, reloadKey }: { period: PeriodValue; reloadKey: unknown }) {
  const range = useMemo(() => periodRange(period), [period]);
  const [data, setData] = useState<PnlByLocationDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.finance
      .pnlLocations(range.from.toISOString(), range.to.toISOString())
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось загрузить ОПиУ по точкам"));
    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  const columns = data ? [...data.columns.map((c) => ({ key: c.locationId ?? "rest", label: c.locationName, f: c.figures })), { key: "total", label: "Итого", f: data.total }] : [];
  // A percent without revenue is just empty; only the income tax can be «не настроен».
  const show = (line: Line, v: number | null) => (v === null ? (line.percent ? "—" : "не настроен") : line.percent ? `${v.toFixed(1)}%` : formatMoney(v));

  function exportExcel() {
    if (!data) return;
    void downloadTable(
      `opiu-po-tochkam-${period}`,
      ["Показатель", ...columns.map((c) => c.label)],
      LINES.map((line) => [
        line.label,
        ...columns.map((c) => {
          const v = line.value(c.f);
          if (v === null) return "—";
          return line.percent ? { v, fmt: "percent" as const } : { v, fmt: "money" as const, bold: line.strong };
        }),
      ]),
      { sheetName: "По точкам", titleLines: [`ОПиУ по точкам · ${periodLabel(period)}`] },
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">ОПиУ по точкам</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={exportExcel}
            disabled={!data}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" strokeWidth={1.75} />
            Excel
          </button>
          <button
            onClick={() => withExportTarget("pdf", () => exportExcel())}
            disabled={!data}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            PDF
          </button>
        </div>
      </div>
      {error && <p className="m-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="px-5 py-6 text-sm text-muted">Загрузка…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="px-5 py-3 font-medium">Показатель</th>
                {columns.map((c) => (
                  <th key={c.key} className={clsx("whitespace-nowrap px-4 py-3 text-right font-medium", c.key === "total" && "text-foreground")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {LINES.map((line) => (
                <tr key={line.label} className={clsx(line.strong && "bg-surface-muted")}>
                  <td className={clsx("whitespace-nowrap px-5 py-2", line.strong ? "font-semibold text-foreground" : "text-muted", line.minus && "pl-9")}>{line.label}</td>
                  {columns.map((c) => {
                    const v = line.value(c.f);
                    return (
                      <td
                        key={c.key}
                        className={clsx(
                          "whitespace-nowrap px-4 py-2 text-right tabular-nums",
                          line.strong ? "font-semibold text-foreground" : "text-foreground",
                          line.strong && v !== null && v < 0 && "text-red-700",
                        )}
                      >
                        {show(line, v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
