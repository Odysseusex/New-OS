"use client";

import { useEffect, useMemo, useState } from "react";
import type { DirectionPnlDto, DirectionPnlRowDto } from "@bakery-os/shared";
import { BUSINESS_DIRECTION_LABELS_RU, NET_PROFIT_STATUS_LABELS_RU, NetProfitStatus } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { periodRange, type PeriodValue } from "@/lib/period";
import { formatMoney } from "@/lib/format";

type Figures = Omit<DirectionPnlRowDto, "direction" | "revenueSharePercent"> & { revenueSharePercent?: number | null };

// Costs read as deductions, the way the P&L above shows them.
const minus = (v: number) => formatMoney(v === 0 ? 0 : -v);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

// Финансы → P&L → «По направлениям»: опт / розница / заказы side by side with
// the total. Выручка and себестоимость are each direction's own; common costs
// are allocated by share of revenue (the server does all of it).
export function DirectionPnlCard({ period, locationId, reloadKey }: { period: PeriodValue; locationId: string; reloadKey: unknown }) {
  const range = useMemo(() => periodRange(period), [period]);
  const [data, setData] = useState<DirectionPnlDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.finance
      .pnlDirections(range.from.toISOString(), range.to.toISOString(), locationId || undefined)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось загрузить прибыль по направлениям"));
    return () => {
      cancelled = true;
    };
  }, [range, locationId, reloadKey]);

  const columns: { key: string; label: string; f: Figures }[] = data
    ? [
        ...data.rows.map((r) => ({ key: r.direction, label: BUSINESS_DIRECTION_LABELS_RU[r.direction], f: r as Figures })),
        { key: "total", label: "Итого", f: { ...data.total, revenueSharePercent: data.allocated ? 100 : null } },
      ]
    : [];

  const lines: { label: string; value: (f: Figures) => string; strong?: boolean; muted?: boolean }[] = [
    { label: "Количество чеков", value: (f) => String(f.checks), muted: true },
    { label: "Чистая выручка", value: (f) => formatMoney(f.netRevenue), strong: true },
    { label: "Доля выручки", value: (f) => pct(f.revenueSharePercent), muted: true },
    { label: "Себестоимость", value: (f) => minus(f.cogs) },
    { label: "Валовая прибыль", value: (f) => formatMoney(f.grossProfit), strong: true },
    { label: "Маржинальность", value: (f) => pct(f.grossMarginPercent), muted: true },
    { label: "Потери по запасам", value: (f) => minus(f.inventoryLosses) },
    { label: "Операционные расходы", value: (f) => minus(f.expenses) },
    { label: "Амортизация", value: (f) => minus(f.depreciation) },
    { label: "Операционная прибыль", value: (f) => formatMoney(f.operatingProfit), strong: true },
    { label: "Прочие доходы и расходы", value: (f) => formatMoney(f.otherResult) },
    { label: "Налог на прибыль", value: (f) => (f.incomeTax === null ? "не настроен" : minus(f.incomeTax)) },
    {
      label: `Чистая прибыль${data && data.netProfitStatus !== NetProfitStatus.COMPLETE ? ` — ${NET_PROFIT_STATUS_LABELS_RU[data.netProfitStatus].toLowerCase()}` : ""}`,
      value: (f) => formatMoney(f.netProfit),
      strong: true,
    },
  ];

  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Прибыль по направлениям</h2>
      </div>
      {error && <p className="m-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="px-5 py-6 text-sm text-muted">Загрузка…</p>}
      {data && (
        <>
          {!data.allocated && (
            <p className="mx-5 mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Выручка за период не положительная — общие расходы не распределены, они только в итоге
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium" />
                  {columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-5 py-3 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line) => (
                  <tr key={line.label}>
                    <td className={`whitespace-nowrap px-5 py-2.5 ${line.strong ? "font-semibold text-foreground" : line.muted ? "text-muted" : "text-foreground"}`}>
                      {line.label}
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`whitespace-nowrap px-5 py-2.5 text-right ${line.strong ? "font-semibold text-foreground" : line.muted ? "text-muted" : "text-foreground"} ${c.key === "total" ? "bg-surface-muted" : ""}`}
                      >
                        {line.value(c.f)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
