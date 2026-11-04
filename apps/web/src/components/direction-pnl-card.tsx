"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, FileText} from "lucide-react";
import type { DirectionAllocationDto, DirectionPnlDto, DirectionPnlRowDto } from "@bakery-os/shared";
import {
  BUSINESS_DIRECTION_LABELS_RU,
  BUSINESS_DIRECTION_ORDER,
  BusinessDirection,
  DIRECTION_ALLOCATION_BASE_LABELS_RU,
  DIRECTION_ALLOCATION_ROLES,
  DirectionAllocationBase,
  NET_PROFIT_STATUS_LABELS_RU,
  NetProfitStatus,
  directionSharesError,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { periodLabel, periodRange, type PeriodValue } from "@/lib/period";
import { formatMoney } from "@/lib/format";
import type { XlsxSheet } from "@/lib/xlsx";
import { downloadTable, withExportTarget } from "@/lib/export-table";

type Figures = Omit<DirectionPnlRowDto, "direction" | "revenueSharePercent" | "allocationSharePercent"> & {
  revenueSharePercent?: number | null;
  allocationSharePercent?: number | null;
};

// Costs read as deductions, the way the P&L above shows them.
const neg = (v: number) => (v === 0 ? 0 : -v);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

type Line = { label: string; value: (f: Figures) => number | null; kind?: "money" | "percent" | "count"; strong?: boolean; muted?: boolean; nullText?: string };

// Финансы → P&L → «Прибыль по направлениям»: опт / розница / заказы side by side
// with the total. Выручка and себестоимость are each direction's own; common
// costs are shared by the organization's chosen base (the server does all of it).
export function DirectionPnlCard({
  period,
  locationId,
  reloadKey,
  onSheet,
}: {
  period: PeriodValue;
  locationId: string;
  reloadKey: unknown;
  onSheet?: (sheet: XlsxSheet | null) => void;
}) {
  const { user } = useAuth();
  const canChoose = user ? DIRECTION_ALLOCATION_ROLES.includes(user.role) : false;
  const range = useMemo(() => periodRange(period), [period]);
  const [data, setData] = useState<DirectionPnlDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

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
  }, [range, locationId, reloadKey, version]);

  const columns: { key: string; label: string; f: Figures }[] = data
    ? [
        ...data.rows.map((r) => ({ key: r.direction, label: BUSINESS_DIRECTION_LABELS_RU[r.direction], f: r as Figures })),
        { key: "total", label: "Итого", f: { ...data.total, revenueSharePercent: data.allocated ? 100 : null, allocationSharePercent: data.allocated ? 100 : null } },
      ]
    : [];

  const lines: Line[] = [
    { label: "Количество чеков", value: (f) => f.checks, kind: "count", muted: true },
    { label: "Чистая выручка", value: (f) => f.netRevenue, strong: true },
    { label: "Доля выручки", value: (f) => f.revenueSharePercent ?? null, kind: "percent", muted: true },
    { label: "Себестоимость", value: (f) => neg(f.cogs) },
    { label: "Валовая прибыль", value: (f) => f.grossProfit, strong: true },
    { label: "Маржинальность", value: (f) => f.grossMarginPercent, kind: "percent", muted: true },
    { label: "Прибыль до распределения", value: (f) => f.profitBeforeAllocation, strong: true },
    { label: "Доля общих расходов", value: (f) => f.allocationSharePercent ?? null, kind: "percent", muted: true },
    { label: "Распределённые общие расходы", value: (f) => neg(f.allocatedCosts) },
    { label: "Потери по запасам", value: (f) => neg(f.inventoryLosses) },
    { label: "Операционные расходы", value: (f) => neg(f.expenses) },
    { label: "в т.ч. прямые расходы направления", value: (f) => neg(f.directExpenses), muted: true },
    { label: "EBITDA", value: (f) => f.ebitda, strong: true },
    { label: "Амортизация", value: (f) => neg(f.depreciation) },
    { label: "Операционная прибыль (EBIT)", value: (f) => f.operatingProfit, strong: true },
    { label: "Прочие доходы и расходы", value: (f) => f.otherResult },
    { label: "Налог на прибыль", value: (f) => (f.incomeTax === null ? null : neg(f.incomeTax)), nullText: "не настроен" },
    {
      label: `Прибыль после распределения (чистая)${data && data.netProfitStatus !== NetProfitStatus.COMPLETE ? ` — ${NET_PROFIT_STATUS_LABELS_RU[data.netProfitStatus].toLowerCase()}` : ""}`,
      value: (f) => f.netProfit,
      strong: true,
    },
    { label: "Рентабельность по чистой прибыли", value: (f) => (f.netRevenue > 0 ? (f.netProfit / f.netRevenue) * 100 : null), kind: "percent", muted: true },
  ];

  const show = (line: Line, f: Figures) => {
    const v = line.value(f);
    if (v === null) return line.nullText ?? "—";
    if (line.kind === "percent") return pct(v);
    if (line.kind === "count") return String(v);
    return formatMoney(v);
  };

  const sheet: XlsxSheet | null = data
    ? {
        name: "По направлениям",
        titleLines: [`Прибыль по направлениям · ${periodLabel(period)}`, `База распределения общих расходов: ${DIRECTION_ALLOCATION_BASE_LABELS_RU[data.allocation.base]}`],
        headers: ["Показатель", ...columns.map((c) => (c.key === "total" ? "Итого" : `${c.label}`))],
        rows: lines.map((line) => [
          line.label,
          ...columns.map((c) => {
            const v = line.value(c.f);
            if (v === null) return line.nullText ?? "—";
            if (line.kind === "percent") return { v, fmt: "percent" as const };
            if (line.kind === "count") return v;
            return { v, fmt: "money" as const, bold: line.strong };
          }),
        ]),
      }
    : null;
  useEffect(() => onSheet?.(sheet), [data, period]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onSheet?.(null), [onSheet]);

  function exportExcel() {
    if (!sheet) return;
    void downloadTable(`pribyl-po-napravleniyam-${period}`, sheet.headers, sheet.rows, { sheetName: sheet.name, titleLines: sheet.titleLines });
  }

  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Прибыль по направлениям</h2>
        <div className="flex flex-wrap items-center gap-2">
          {data && <AllocationControl allocation={data.allocation} canChoose={canChoose} onSaved={() => setVersion((v) => v + 1)} />}
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
        <>
          {!data.allocated && (
            <p className="mx-5 mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              База распределения за период не положительная — общие расходы не распределены, они только в итоге
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
                        {show(line, c.f)}
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

// The base common costs are shared by; percentages typed for «Вручную».
function AllocationControl({ allocation, canChoose, onSaved }: { allocation: DirectionAllocationDto; canChoose: boolean; onSaved: () => void }) {
  const [base, setBase] = useState(allocation.base);
  const [shares, setShares] = useState<Record<BusinessDirection, string>>(() =>
    Object.fromEntries(BUSINESS_DIRECTION_ORDER.map((d) => [d, allocation.shares ? String(allocation.shares[d] ?? 0) : ""])) as Record<BusinessDirection, string>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBase(allocation.base);
    if (allocation.shares) setShares(Object.fromEntries(BUSINESS_DIRECTION_ORDER.map((d) => [d, String(allocation.shares![d] ?? 0)])) as Record<BusinessDirection, string>);
  }, [allocation]);

  async function save(next: DirectionAllocationBase) {
    setError(null);
    const numbers =
      next === DirectionAllocationBase.MANUAL
        ? (Object.fromEntries(BUSINESS_DIRECTION_ORDER.map((d) => [d, Number((shares[d] || "0").replace(",", "."))])) as Record<BusinessDirection, number>)
        : null;
    if (numbers) {
      const problem = directionSharesError(numbers);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setSaving(true);
    try {
      await api.finance.setDirectionAllocation({ base: next, shares: numbers });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить базу распределения");
    } finally {
      setSaving(false);
    }
  }

  if (!canChoose) {
    return <span className="text-sm text-muted">{DIRECTION_ALLOCATION_BASE_LABELS_RU[allocation.base]}</span>;
  }

  const manualDirty =
    base === DirectionAllocationBase.MANUAL &&
    (allocation.base !== DirectionAllocationBase.MANUAL || BUSINESS_DIRECTION_ORDER.some((d) => Number(shares[d] || 0) !== (allocation.shares?.[d] ?? 0)));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={base}
        disabled={saving}
        onChange={(e) => {
          const next = e.target.value as DirectionAllocationBase;
          setBase(next);
          setError(null);
          if (next !== DirectionAllocationBase.MANUAL) void save(next);
        }}
        aria-label="База распределения общих расходов"
        className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        {Object.values(DirectionAllocationBase).map((b) => (
          <option key={b} value={b}>
            {DIRECTION_ALLOCATION_BASE_LABELS_RU[b]}
          </option>
        ))}
      </select>
      {base === DirectionAllocationBase.MANUAL && (
        <>
          {BUSINESS_DIRECTION_ORDER.map((d) => (
            <label key={d} className="flex items-center gap-1 text-sm text-muted">
              {BUSINESS_DIRECTION_LABELS_RU[d]}
              <input
                inputMode="decimal"
                value={shares[d]}
                onChange={(e) => setShares((cur) => ({ ...cur, [d]: e.target.value }))}
                className="w-14 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              %
            </label>
          ))}
          {manualDirty && (
            <button
              onClick={() => void save(DirectionAllocationBase.MANUAL)}
              disabled={saving}
              className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              Сохранить
            </button>
          )}
        </>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
