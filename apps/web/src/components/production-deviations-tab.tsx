"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, FileText} from "lucide-react";
import type { LocationDto, ProductionDeviationReportDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { PeriodPicker } from "@/components/period-picker";
import { periodLabel, periodRange, type PeriodValue } from "@/lib/period";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { downloadTable, withExportTarget } from "@/lib/export-table";

// Производство → «Отклонения»: raw material really used against the recipe norm.
export function ProductionDeviationsTab({ locations, isOrgWide }: { locations: LocationDto[]; isOrgWide: boolean }) {
  const [period, setPeriod] = useState<PeriodValue>("30d");
  const [locationId, setLocationId] = useState("");
  const [report, setReport] = useState<ProductionDeviationReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const range = useMemo(() => periodRange(period), [period]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.production
      .deviations({ from: range.from.toISOString(), to: range.to.toISOString(), locationId: locationId || undefined })
      .then(setReport)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить отчёт"))
      .finally(() => setLoading(false));
  }, [range, locationId]);

  const signed = (n: number) => (n > 0 ? `+${formatQuantity(n)}` : n < 0 ? `−${formatQuantity(-n)}` : "0");
  const tone = (n: number) => (n > 0 ? "text-red-600" : n < 0 ? "text-emerald-700" : "text-muted");

  function exportExcel() {
    if (!report) return;
    void downloadTable(
      `otkloneniya-${period}`,
      ["Дата", "Точка", "Изделие", "Выпуск", "Сырьё", "Норма", "Факт", "Отклонение", "Ед.", "Сумма отклонения, ₸"],
      report.lines.map((l) => [
        formatDateTime(l.completedAt),
        l.locationName,
        l.productName,
        l.outputQuantity,
        l.ingredientName,
        l.norm,
        l.actual,
        l.deviation,
        UNIT_LABELS_RU[l.unit],
        l.deviationValue ?? "—",
      ]),
      { sheetName: "Отклонения", titleLines: [`Отклонения от техкарты · ${periodLabel(period)}`] },
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
            disabled={!report || report.lines.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" strokeWidth={1.75} />
            Excel
          </button>
          <button
            onClick={() => withExportTarget("pdf", () => exportExcel())}
            disabled={!report || report.lines.length === 0}
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
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Заданий завершено" value={String(report.batchesCount)} />
            <Stat label="Перерасход" value={formatMoney(report.overuseValue)} tone={report.overuseValue > 0 ? "text-red-600" : undefined} />
            <Stat label="Экономия" value={formatMoney(report.savingValue)} tone={report.savingValue > 0 ? "text-emerald-700" : undefined} />
          </div>

          <h2 className="mb-2 text-sm font-semibold text-foreground">По сырью</h2>
          <div className="mb-6 overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">Сырьё</th>
                  <th className="px-4 py-2.5 text-right font-medium">Норма</th>
                  <th className="px-4 py-2.5 text-right font-medium">Факт</th>
                  <th className="px-4 py-2.5 text-right font-medium">Отклонение</th>
                  <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.byIngredient.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted">
                      Нет завершённых заданий за период
                    </td>
                  </tr>
                )}
                {report.byIngredient.map((r) => (
                  <tr key={r.ingredientId}>
                    <td className="px-4 py-2.5 text-foreground">{r.ingredientName}</td>
                    <td className="px-4 py-2.5 text-right text-muted">
                      {formatQuantity(r.norm)} {UNIT_LABELS_RU[r.unit]}
                    </td>
                    <td className="px-4 py-2.5 text-right text-foreground">
                      {formatQuantity(r.actual)} {UNIT_LABELS_RU[r.unit]}
                    </td>
                    <td className={`px-4 py-2.5 text-right ${tone(r.deviation)}`}>
                      {signed(r.deviation)} {UNIT_LABELS_RU[r.unit]}
                    </td>
                    <td className={`px-4 py-2.5 text-right ${tone(r.deviationValue)}`}>{formatMoney(r.deviationValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.lines.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-semibold text-foreground">По заданиям</h2>
              <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 font-medium">Дата</th>
                      <th className="px-4 py-2.5 font-medium">Изделие</th>
                      <th className="px-4 py-2.5 font-medium">Сырьё</th>
                      <th className="px-4 py-2.5 text-right font-medium">Норма</th>
                      <th className="px-4 py-2.5 text-right font-medium">Факт</th>
                      <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.lines.map((l) => (
                      <tr key={`${l.batchId}:${l.ingredientId}`}>
                        <td className="px-4 py-2.5 text-muted">{formatDateTime(l.completedAt)}</td>
                        <td className="px-4 py-2.5 text-foreground">
                          {l.productName}
                          <span className="ml-1.5 text-xs text-muted">
                            {formatQuantity(l.outputQuantity)} {UNIT_LABELS_RU[l.outputUnit]} · {l.locationName}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-foreground">{l.ingredientName}</td>
                        <td className="px-4 py-2.5 text-right text-muted">
                          {formatQuantity(l.norm)} {UNIT_LABELS_RU[l.unit]}
                        </td>
                        <td className={`px-4 py-2.5 text-right ${tone(l.deviation)}`}>
                          {formatQuantity(l.actual)} {UNIT_LABELS_RU[l.unit]}
                        </td>
                        <td className={`px-4 py-2.5 text-right ${tone(l.deviationValue ?? 0)}`}>
                          {l.deviationValue === null ? "—" : formatMoney(l.deviationValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}
