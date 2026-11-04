"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { FileDown, FileText} from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LocationDto, ProductionOutputReportDto, ProductionUnitCostMonthDto, ProductionUnitCostTrendDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { PeriodPicker } from "@/components/period-picker";
import { periodLabel, periodRange, type PeriodValue } from "@/lib/period";
import { formatMoney, formatQuantity } from "@/lib/format";
import { downloadTable, withExportTarget } from "@/lib/export-table";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthLabel = (key: string) => `${MONTHS_RU[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

// Производство → «Выпуск»: output by product and point at the ingredients' cost,
// and one product's unit cost month by month.
export function ProductionOutputTab({ locations, isOrgWide }: { locations: LocationDto[]; isOrgWide: boolean }) {
  const [period, setPeriod] = useState<PeriodValue>("month");
  const [locationId, setLocationId] = useState("");
  const [report, setReport] = useState<ProductionOutputReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [productId, setProductId] = useState<string | null>(null);
  const range = useMemo(() => periodRange(period), [period]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.production
      .output({ from: range.from.toISOString(), to: range.to.toISOString(), locationId: locationId || undefined })
      .then(setReport)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить отчёт"))
      .finally(() => setLoading(false));
  }, [range, locationId]);

  function exportExcel() {
    if (!report) return;
    void downloadTable(
      `vypusk-${period}`,
      ["Изделие", "Точка", "Заданий", "Выпуск", "Ед.", "Себестоимость, ₸", "Себестоимость ед., ₸"],
      report.rows.map((r) => [r.productName, r.locationName, r.batches, r.quantity, UNIT_LABELS_RU[r.unit], r.cost, r.unitCost ?? "—"]),
      { sheetName: "Выпуск", titleLines: [`Выпуск продукции · ${periodLabel(period)}`] },
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="flex items-center gap-2">
          {isOrgWide && (
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Вся сеть</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={exportExcel}
            disabled={!report || report.rows.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" strokeWidth={1.75} />
            Excel
          </button>
          <button
            onClick={() => withExportTarget("pdf", () => exportExcel())}
            disabled={!report || report.rows.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            PDF
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loading && !report && <p className="py-10 text-center text-sm text-muted">Загрузка…</p>}

      {report && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Изделие</th>
                <th className="px-4 py-2.5 font-medium">Точка</th>
                <th className="px-4 py-2.5 text-right font-medium">Заданий</th>
                <th className="px-4 py-2.5 text-right font-medium">Выпуск</th>
                <th className="px-4 py-2.5 text-right font-medium">Себестоимость</th>
                <th className="px-4 py-2.5 text-right font-medium">Себестоимость ед.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    Нет завершённых заданий за период
                  </td>
                </tr>
              )}
              {report.rows.map((r) => {
                const open = productId === r.productId;
                return (
                  <Fragment key={`${r.productId}:${r.locationId}`}>
                    <tr
                      onClick={() => setProductId(open ? null : r.productId)}
                      className={`cursor-pointer hover:bg-surface-muted ${open ? "bg-surface-muted" : ""}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{r.productName}</td>
                      <td className="px-4 py-2.5 text-muted">{r.locationName}</td>
                      <td className="px-4 py-2.5 text-right text-muted">{r.batches}</td>
                      <td className="px-4 py-2.5 text-right text-foreground">
                        {formatQuantity(r.quantity)} {UNIT_LABELS_RU[r.unit]}
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground">{formatMoney(r.cost)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-foreground">{r.unitCost === null ? "—" : formatMoney(r.unitCost)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} className="bg-surface px-4 py-3">
                          <UnitCostTrend productId={r.productId} locationId={locationId || undefined} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="px-4 py-2.5 text-foreground" colSpan={4}>
                    Итого
                  </td>
                  <td className="px-4 py-2.5 text-right text-foreground">{formatMoney(report.totalCost)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function UnitCostTrend({ productId, locationId }: { productId: string; locationId?: string }) {
  const [trend, setTrend] = useState<ProductionUnitCostTrendDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    setTrend(null);
    setError(null);
    api.production
      .unitCostTrend({ productId, months: 12, locationId })
      .then(setTrend)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить динамику"));
  }, [productId, locationId]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!trend || !isMounted) return <div className="h-60" />;
  const withCost = trend.months.filter((m) => m.unitCost !== null);

  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-foreground">Себестоимость единицы по месяцам · {trend.productName}</p>
      {withCost.length === 0 ? (
        <p className="py-6 text-sm text-muted">Нет выпуска за 12 месяцев</p>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend.months} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: "var(--muted)", fontSize: 11 }} stroke="var(--border)" />
              <YAxis
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                stroke="var(--border)"
                width={64}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => new Intl.NumberFormat("ru-RU").format(v)}
              />
              <Tooltip content={<TrendTooltip unit={UNIT_LABELS_RU[trend.unit]} />} cursor={{ stroke: "var(--border)" }} />
              <Line type="monotone" dataKey="unitCost" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function TrendTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: ProductionUnitCostMonthDto }[]; unit: string }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
      <p className="text-xs font-medium text-foreground">{monthLabel(m.month)}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{m.unitCost === null ? "Не производили" : `${formatMoney(m.unitCost)} за ${unit}`}</p>
      {m.quantity > 0 && (
        <p className="text-xs text-muted">
          выпуск {formatQuantity(m.quantity)} {unit} · {formatMoney(m.cost)}
        </p>
      )}
    </div>
  );
}
