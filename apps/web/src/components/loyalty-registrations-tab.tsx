"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, FileText } from "lucide-react";
import type { LoyaltyRegistrationCountsDto, LoyaltyRegistrationsDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { PeriodPicker } from "@/components/period-picker";
import { periodLabel, periodRange, type PeriodValue } from "@/lib/period";
import { downloadTable, withExportTarget } from "@/lib/export-table";
import { formatDayKey } from "@/lib/format";

// Клиенты → «Регистрации»: new bonus-programme members of a period, by cashier and by day.
// An app member counts for the cashier who rang up their first purchase.
export function LoyaltyRegistrationsTab() {
  const [period, setPeriod] = useState<PeriodValue>("30d");
  const range = useMemo(() => periodRange(period), [period]);
  const [report, setReport] = useState<LoyaltyRegistrationsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api.loyalty
      .registrations(range.from.toISOString(), range.to.toISOString())
      .then((r) => live && setReport(r))
      .catch((err) => live && (setReport(null), setError(err instanceof ApiError ? err.message : "Не удалось загрузить отчёт")))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [range]);

  const cells = (r: LoyaltyRegistrationCountsDto) => [r.total, r.viaApp, r.atTill, r.withAppNow];
  const HEAD = ["Новых клиентов", "Через приложение", "По номеру на кассе", "Сейчас в приложении"];

  function exportExcel() {
    if (!report) return;
    void downloadTable(
      `registracii-${period}`,
      ["Кассир", ...HEAD],
      [...report.cashiers.map((c) => [c.name, ...cells(c)]), ["Итого", ...cells(report.totals)], [], ["День", ...HEAD], ...report.days.map((d) => [formatDayKey(d.day), ...cells(d)])],
      { sheetName: "Регистрации", titleLines: [`Регистрации клиентов · ${periodLabel(period)}`] },
    );
  }

  const empty = report && report.totals.total === 0;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="flex items-center gap-2">
          <button
            onClick={exportExcel}
            disabled={!report || !!empty}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" strokeWidth={1.75} />
            Excel
          </button>
          <button
            onClick={() => withExportTarget("pdf", () => exportExcel())}
            disabled={!report || !!empty}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            PDF
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loading && !report && <p className="py-10 text-center text-sm text-muted">Загрузка…</p>}
      {empty && <p className="py-10 text-center text-sm text-muted">За период новых клиентов нет</p>}

      {report && !empty && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {HEAD.map((label, i) => (
              <div key={label} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{cells(report.totals)[i]}</p>
              </div>
            ))}
          </div>

          <Table title="По кассирам" first="Кассир" rows={report.cashiers.map((c) => ({ key: c.key, label: c.name, values: cells(c) }))} head={HEAD} total={cells(report.totals)} />
          <Table title="По дням" first="День" rows={report.days.map((d) => ({ key: d.day, label: formatDayKey(d.day), values: cells(d) }))} head={HEAD} />
        </>
      )}
    </div>
  );
}

function Table({ title, first, head, rows, total }: { title: string; first: string; head: string[]; rows: { key: string; label: string; values: number[] }[]; total?: number[] }) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold text-foreground">{title}</h2>
      <div className="overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">{first}</th>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">{r.label}</td>
                {r.values.map((v, i) => (
                  <td key={i} className="px-3 py-2 text-right tabular-nums text-foreground">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            {total && (
              <tr className="bg-surface-muted font-semibold">
                <td className="px-3 py-2 text-foreground">Итого</td>
                {total.map((v, i) => (
                  <td key={i} className="px-3 py-2 text-right tabular-nums text-foreground">
                    {v}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
