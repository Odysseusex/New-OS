"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Search, FileText} from "lucide-react";
import type { LocationDto, StockTurnoverDto, Unit } from "@bakery-os/shared";
import { PRODUCT_TYPE_LABELS_RU, ProductType, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { PeriodPicker } from "@/components/period-picker";
import { periodRange, type PeriodValue } from "@/lib/period";
import { downloadTable, withExportTarget } from "@/lib/export-table";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";

const selectClass =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const unitLabel = (u: string) => UNIT_LABELS_RU[u as Unit] ?? u;

// Склад → «ОСВ»: оборотно-сальдовая ведомость по товарам — начало, приход,
// расход, конец, в количестве и в сумме. The closing columns are the stock on
// the period's last day («остатки на дату»).
export function StockTurnoverTab({ locations, isOrgWide }: { locations: LocationDto[]; isOrgWide: boolean }) {
  const [period, setPeriod] = useState<PeriodValue>("month");
  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [data, setData] = useState<StockTurnoverDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const range = useMemo(() => periodRange(period), [period]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.inventory
      .turnover({ from: range.from.toISOString(), to: range.to.toISOString(), locationId: locationId || undefined })
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось построить ведомость"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, locationId]);

  const q = query.trim().toLowerCase();
  // Группа = the top-level category («Родитель › Под» → «Родитель»).
  const groupOf = (name: string | null | undefined) => (name ? name.split(" › ")[0] : "Без группы");
  const groups = Array.from(new Set((data?.lines ?? []).map((l) => groupOf(l.categoryName)))).sort((a, b) => a.localeCompare(b, "ru"));
  const lines = (data?.lines ?? []).filter(
    (l) => (!type || l.productType === type) && (!group || groupOf(l.categoryName) === group) && (!q || l.productName.toLowerCase().includes(q)),
  );
  const totals = lines.reduce(
    (s, l) => ({ o: s.o + l.openingValue, i: s.i + l.inValue, x: s.x + l.outValue, c: s.c + l.closingValue }),
    { o: 0, i: 0, x: 0, c: 0 },
  );
  const locationName = locations.find((l) => l.id === locationId)?.name ?? "Вся сеть";

  function exportExcel() {
    if (!data) return;
    downloadTable(
      `osv-tovary-${range.from.toISOString().slice(0, 10)}-${range.to.toISOString().slice(0, 10)}.xlsx`,
      ["Товар", "Категория", "Ед.", "Начало, кол-во", "Начало, сумма", "Приход, кол-во", "Приход, сумма", "Расход, кол-во", "Расход, сумма", "Конец, кол-во", "Конец, средняя цена", "Конец, сумма"],
      lines.map((l) => [
        l.productName,
        l.categoryName ?? "",
        unitLabel(l.unit),
        l.openingQuantity,
        { v: l.openingValue, fmt: "money" as const },
        l.inQuantity,
        { v: l.inValue, fmt: "money" as const },
        l.outQuantity,
        { v: l.outValue, fmt: "money" as const },
        l.closingQuantity,
        closingPrice(l.closingQuantity, l.closingValue) === null ? "" : { v: closingPrice(l.closingQuantity, l.closingValue) as number, fmt: "money" as const },
        { v: l.closingValue, fmt: "money" as const },
      ]),
      {
        sheetName: "ОСВ",
        titleLines: [`Оборотно-сальдовая ведомость по товарам — ${locationName}`, `${formatDateTime(data.from)} — ${formatDateTime(data.to)}`],
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        {isOrgWide && (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass}>
            <option value="">Вся сеть</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={selectClass} aria-label="Группа товаров">
          <option value="">Все группы</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          <option value="">Все типы</option>
          {Object.values(ProductType).map((t) => (
            <option key={t} value={t}>
              {PRODUCT_TYPE_LABELS_RU[t]}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск товара…"
            className="w-56 rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <button
          type="button"
          disabled={!data}
          onClick={exportExcel}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
        >
          <Download className="h-4 w-4" strokeWidth={1.75} />
          Excel
        </button>
        <button
          type="button"
          disabled={!data}
          onClick={() => withExportTarget("pdf", () => exportExcel())}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
        >
          <FileText className="h-4 w-4" strokeWidth={1.75} />
          PDF
        </button>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {data && data.unvaluedFlows > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Движений без себестоимости: {data.unvaluedFlows} — учтены только в количестве</p>
      )}

      <div className={`overflow-x-auto rounded-2xl border border-border bg-surface shadow-card ${loading && data ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Товар</th>
              <th className="px-4 py-3 text-right font-medium">Начало</th>
              <th className="px-4 py-3 text-right font-medium">Приход</th>
              <th className="px-4 py-3 text-right font-medium">Расход</th>
              <th className="px-4 py-3 text-right font-medium">Конец</th>
              <th className="px-4 py-3 text-right font-medium">Средняя цена</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!data && loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Загрузка…
                </td>
              </tr>
            )}
            {data && lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Движений за период нет
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.productId}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-foreground">{l.productName}</div>
                  {l.categoryName && <div className="text-xs text-muted">{l.categoryName}</div>}
                </td>
                <Cell q={l.openingQuantity} v={l.openingValue} unit={l.unit} />
                <Cell q={l.inQuantity} v={l.inValue} unit={l.unit} />
                <Cell q={l.outQuantity} v={l.outValue} unit={l.unit} />
                <Cell q={l.closingQuantity} v={l.closingValue} unit={l.unit} strong />
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-foreground">
                  {closingPrice(l.closingQuantity, l.closingValue) === null ? <span className="text-muted">—</span> : formatMoney(closingPrice(l.closingQuantity, l.closingValue) as number)}
                </td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-border font-semibold text-foreground">
                <td className="px-4 py-3">Итого</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{formatMoney(totals.o)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{formatMoney(totals.i)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{formatMoney(totals.x)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{formatMoney(totals.c)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// Average price of what is left at the end: its value over its quantity (4 places, like the average itself).
function closingPrice(quantity: number, value: number): number | null {
  return quantity > 0.0005 ? Math.round((value / quantity) * 10000) / 10000 : null;
}

function Cell({ q, v, unit, strong }: { q: number; v: number; unit: string; strong?: boolean }) {
  const zero = Math.abs(q) < 0.0005 && Math.abs(v) < 0.005;
  return (
    <td className="whitespace-nowrap px-4 py-2.5 text-right">
      {zero ? (
        <span className="text-muted">—</span>
      ) : (
        <>
          <div className={strong ? "font-semibold text-foreground" : "text-foreground"}>
            {formatQuantity(q)} {unitLabel(unit)}
          </div>
          <div className="text-xs text-muted">{formatMoney(v)}</div>
        </>
      )}
    </td>
  );
}
