"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, Printer, Search } from "lucide-react";
import type { DailyReconciliationDto, LocationDto, ReconciliationHistoryItemDto } from "@bakery-os/shared";
import {
  CASH_MOVEMENT_TYPE_LABELS_RU,
  INVENTORY_MANAGE_ROLES,
  lineDifference,
  ORG_WIDE_ROLES,
  RECONCILIATION_ROLES,
  summarizeReconciliation,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { zonedDateKey } from "@/lib/reporting-period";
import { ProductTrailModal } from "@/components/product-trail-modal";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// "" stays "not entered" (null); anything else must be a number ≥ 0.
const parseAmount = (value: string): number | null => {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const asInput = (value: number | null) => (value === null ? "" : String(value));

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NO_CATEGORY = "Без категории";
const CONSIGNMENT_GROUP = "Под реализацию";
const groupOf = (line: { consignment: boolean; categoryName: string | null }) =>
  line.consignment ? CONSIGNMENT_GROUP : (line.categoryName ?? NO_CATEGORY);

// The paper the cashiers walk the shelf with: every product of the point in the
// screen's own order, a blank to write the count in — and NOT what the system
// expects, so the count is blind.
function printCountSheet(day: DailyReconciliationDto) {
  // Two columns: names are short, so one column left half of every page empty.
  // A group's heading travels with its first product, never alone at a column's foot.
  const row = (line: DailyReconciliationDto["lines"][number]) =>
    `<div class="r"><span class="n">${escapeHtml(line.productName)}</span><span class="b">${escapeHtml(UNIT_LABELS_RU[line.unit])}</span></div>`;
  const groups: { name: string; lines: DailyReconciliationDto["lines"] }[] = [];
  for (const line of day.lines) {
    const name = groupOf(line);
    if (groups.length === 0 || groups[groups.length - 1].name !== name) groups.push({ name, lines: [] });
    groups[groups.length - 1].lines.push(line);
  }
  const body = groups
    .map((g) => `<div class="k"><div class="g">${escapeHtml(g.name)}</div>${row(g.lines[0])}</div>${g.lines.slice(1).map(row).join("")}`)
    .join("");
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Пересчёт витрины</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;margin:14px;color:#000}h1{font-size:17px;margin:0 0 4px}p{margin:4px 0 10px}
.cols{column-count:2;column-gap:18px}.k,.r{break-inside:avoid}
.g{background:#eee;font-weight:bold;padding:5px 6px;border:1px solid #999;margin-top:6px}.k:first-child .g{margin-top:0}
.r{display:flex;align-items:stretch;border:1px solid #999;margin-top:-1px}
.n{flex:1;padding:6px;line-height:1.25}.b{width:70px;border-left:1px solid #999;text-align:right;color:#666;font-size:11px;padding:2px 4px;display:flex;align-items:flex-end;justify-content:flex-end}</style></head><body>
<h1>Пересчёт витрины · ${escapeHtml(day.locationName)} · ${escapeHtml(day.date.split("-").reverse().join("."))}</h1>
<p>Считал(а): ______________________ &nbsp;&nbsp; Время: ________</p>
<div class="cols">${body}</div>
</body></html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

// Enter in a count field goes to the next one, top to bottom — the paper's order.
function focusNextCount(current: HTMLInputElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-count-input]"));
  const next = all[all.indexOf(current) + 1];
  if (next) {
    next.focus();
    next.select();
  } else {
    current.blur();
  }
}

const signTone = (value: number | null) =>
  value === null || Math.abs(value) < 0.005 ? "text-foreground" : value < 0 ? "text-red-600" : "text-green-600";
const signedMoney = (value: number) => (value > 0 ? `+${formatMoney(value)}` : formatMoney(value));
const signedQuantity = (value: number) => (value > 0 ? `+${formatQuantity(value)}` : formatQuantity(value));

export default function ReconciliationPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-muted">Загрузка…</p>}>
      <ReconciliationScreen />
    </Suspense>
  );
}

function ReconciliationScreen() {
  const { user } = useAuth();
  const params = useSearchParams();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const allowed = user ? RECONCILIATION_ROLES.includes(user.role) : false;
  // Applying the counts corrects stock: the same people as «Корректировка» on Склад.
  const canApply = user ? INVENTORY_MANAGE_ROLES.includes(user.role) : false;

  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationId, setLocationId] = useState(params.get("locationId") ?? "");
  const [date, setDate] = useState(params.get("date") ?? zonedDateKey());
  const [day, setDay] = useState<DailyReconciliationDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<ReconciliationHistoryItemDto[]>([]);

  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [countedCard, setCountedCard] = useState("");
  const [countedTransfer, setCountedTransfer] = useState("");
  const [note, setNote] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [trailFor, setTrailFor] = useState<{ productId: string; productName: string } | null>(null);

  // A user tied to one location reconciles that location; the server enforces it too.
  const effectiveLocationId = isOrgWide ? locationId : (user?.locationId ?? "");

  useEffect(() => {
    if (!isOrgWide) return;
    api.locations
      .list()
      .then((all) => {
        setLocations(all);
        setLocationId((current) => current || all.find((l) => l.type === "STORE")?.id || all[0]?.id || "");
      })
      .catch(() => {});
  }, [isOrgWide]);

  const fill = useCallback((data: DailyReconciliationDto) => {
    setDay(data);
    setOpeningCash(asInput(data.openingCash));
    setCountedCash(asInput(data.countedCash));
    setCountedCard(asInput(data.countedCard));
    setCountedTransfer(asInput(data.countedTransfer));
    setNote(data.note ?? "");
    setCounts(Object.fromEntries(data.lines.filter((l) => l.countedQuantity !== null).map((l) => [l.productId, String(l.countedQuantity)])));
    setIsDirty(false);
  }, []);

  const loadHistory = useCallback(() => {
    if (!allowed) return;
    api.reconciliation
      .history(effectiveLocationId || undefined)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [allowed, effectiveLocationId]);

  useEffect(() => {
    if (!allowed || !effectiveLocationId || !date) return;
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    api.reconciliation
      .get(effectiveLocationId, date)
      .then((data) => {
        if (!cancelled) fill(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setDay(null);
        setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить данные за день");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, effectiveLocationId, date, fill]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const lines = useMemo(
    () => (day ? day.lines.map((l) => ({ ...l, countedQuantity: counts[l.productId] !== undefined ? parseAmount(counts[l.productId]) : null })) : []),
    [day, counts],
  );

  const summary = useMemo(
    () =>
      day
        ? summarizeReconciliation({
            money: day.money,
            openingCash: parseAmount(openingCash),
            countedCash: parseAmount(countedCash),
            countedCard: parseAmount(countedCard),
            countedTransfer: parseAmount(countedTransfer),
            lines,
          })
        : null,
    [day, openingCash, countedCash, countedCard, countedTransfer, lines],
  );

  const visibleLines = useMemo(() => {
    const query = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (query && !l.productName.toLowerCase().includes(query)) return false;
      if (onlyDifferences) {
        const d = lineDifference(l);
        if (d === null || Math.abs(d) < 0.0005) return false;
      }
      return true;
    });
  }, [lines, search, onlyDifferences]);

  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setIsDirty(true);
    };
  }

  async function handleSave() {
    if (!day) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const saved = await api.reconciliation.save({
        locationId: day.locationId,
        date: day.date,
        openingCash: parseAmount(openingCash),
        countedCash: parseAmount(countedCash),
        countedCard: parseAmount(countedCard),
        countedTransfer: parseAmount(countedTransfer),
        note: note.trim() || null,
        lines: lines.filter((l) => l.countedQuantity !== null).map((l) => ({ productId: l.productId, countedQuantity: l.countedQuantity as number })),
      });
      fill(saved);
      loadHistory();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Не удалось сохранить сверку");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApply() {
    if (!day || !summary) return;
    const changed = lines.filter((l) => {
      const d = lineDifference(l);
      return d !== null && Math.abs(d) >= 0.0005;
    }).length;
    const question =
      changed === 0
        ? "Расхождений нет — остатки совпадают. Отметить сверку как проведённую?"
        : `Записать в остатки разницу по ${changed} товар(ам): недостача ${formatMoney(summary.shortageValue)}, излишек ${formatMoney(summary.surplusValue)}?\n\nЭто делается один раз: после этого пересчёт товаров в этой сверке изменить нельзя.`;
    if (!window.confirm(question)) return;
    setIsApplying(true);
    setSaveError(null);
    try {
      fill(await api.reconciliation.apply(day.locationId, day.date));
      loadHistory();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Не удалось применить сверку к остаткам");
    } finally {
      setIsApplying(false);
    }
  }

  if (user && !allowed) {
    return <p className="py-10 text-center text-sm text-muted">Нет доступа к сверке дня</p>;
  }

  const money = day?.money;
  const showTransfer = !!money && (money.transferSales > 0 || money.transferRefunds > 0 || countedTransfer !== "");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/sales" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            Продажи
          </Link>
          <h1 className="text-xl font-semibold text-foreground">Сверка дня</h1>
          <p className="mt-1 text-sm text-muted">Касса и остатки точки за день</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {isOrgWide && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Точка</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass}>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Дата</label>
            <input type="date" value={date} max={zonedDateKey()} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          <button
            onClick={() => day && printCountSheet(day)}
            disabled={!day || day.lines.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
          >
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            Печать бланка
          </button>
          <button
            onClick={handleSave}
            disabled={!day || isSaving}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? "Сохранение…" : "Сохранить"}
          </button>
          {canApply && day && !day.appliedAt && (
            <button
              onClick={handleApply}
              disabled={isApplying || isDirty || !day.savedAt || (summary?.countedLines ?? 0) === 0}
              title={isDirty || !day.savedAt ? "Сначала сохраните сверку" : undefined}
              className="rounded-xl border border-accent px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/10 disabled:opacity-50"
            >
              {isApplying ? "Применяю…" : "Применить к остаткам"}
            </button>
          )}
        </div>
      </div>

      {day && (
        <p className="mb-4 text-xs text-muted">
          {isDirty ? "Есть несохранённые изменения" : day.savedAt ? `Сохранено ${formatDateTime(day.savedAt)} · ${day.savedByName}` : "Сверка за этот день ещё не сохранялась"}
          {day.appliedAt && (
            <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">
              Остатки проведены {formatDateTime(day.appliedAt)} · {day.appliedByName}
            </span>
          )}
        </p>
      )}
      {saveError && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>}
      {loadError && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>}
      {isLoading && !day && <p className="py-10 text-center text-sm text-muted">Загрузка…</p>}

      {day && money && summary && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Деньги" value={summary.moneyDifference} />
            <SummaryCard
              label="Товар"
              value={summary.goodsDifference}
              detail={summary.countedLines > 0 ? `Недостача ${formatMoney(summary.shortageValue)} · излишек ${formatMoney(summary.surplusValue)}` : undefined}
            />
            <SummaryCard label="Итог" value={summary.result} emphasis />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Наличные</h2>
              <MoneyInputRow label="Наличные в кассе утром" value={openingCash} onChange={edit(setOpeningCash)} />
              <MoneyRow label="Продажи" value={money.cashSales} />
              <MoneyRow label="Возвраты" value={-money.cashRefunds} />
              {money.tillMovements.map((m) => (
                <MoneyRow key={m.type} label={CASH_MOVEMENT_TYPE_LABELS_RU[m.type]} value={m.amount} />
              ))}
              <MoneyRow label="Должно быть в кассе" value={summary.expectedCash} strong />
              <MoneyInputRow label="Пересчитали вечером" value={countedCash} onChange={edit(setCountedCash)} />
              <DifferenceRow value={summary.cashDifference} />
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Карта / Kaspi</h2>
              <MoneyRow label="Продажи" value={money.cardSales} />
              <MoneyRow label="Возвраты" value={-money.cardRefunds} />
              <MoneyRow label="Должно прийти" value={summary.expectedCard} strong />
              <MoneyInputRow label="Пришло по Kaspi / терминалу" value={countedCard} onChange={edit(setCountedCard)} />
              <DifferenceRow value={summary.cardDifference} />

              {showTransfer && (
                <>
                  <h2 className="mb-3 mt-5 text-sm font-semibold text-foreground">Перевод</h2>
                  <MoneyRow label="Продажи" value={money.transferSales} />
                  <MoneyRow label="Возвраты" value={-money.transferRefunds} />
                  <MoneyRow label="Должно прийти" value={summary.expectedTransfer} strong />
                  <MoneyInputRow label="Пришло переводами" value={countedTransfer} onChange={edit(setCountedTransfer)} />
                  <DifferenceRow value={summary.transferDifference} />
                </>
              )}
              {money.onCredit > 0 && (
                <p className="mt-4 border-t border-border pt-3 text-sm text-muted">
                  В долг: <span className="text-foreground">{formatMoney(money.onCredit)}</span>
                </p>
              )}
            </div>
          </div>

          <div className="mb-6 rounded-2xl border border-border bg-surface shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">
                Остатки · посчитано {summary.countedLines} из {summary.totalLines}
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} className="h-4 w-4 accent-accent" />
                  Только с расхождением
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск товара…"
                    className="rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Товар</th>
                    <th className="px-3 py-3 text-right font-medium">Начало</th>
                    <th className="px-3 py-3 text-right font-medium">Приход</th>
                    <th className="px-3 py-3 text-right font-medium">Продано</th>
                    <th className="px-3 py-3 text-right font-medium">Возврат</th>
                    <th className="px-3 py-3 text-right font-medium">Списано / прочее</th>
                    <th className="px-3 py-3 text-right font-medium">Должно быть</th>
                    <th className="px-3 py-3 text-right font-medium">Посчитали</th>
                    <th className="px-3 py-3 text-right font-medium">Разница</th>
                    <th className="px-4 py-3 text-right font-medium">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleLines.map((line, index) => {
                    const d = lineDifference(line);
                    const group = groupOf(line);
                    const newGroup = index === 0 || groupOf(visibleLines[index - 1]) !== group;
                    return (
                      <Fragment key={line.productId}>
                      {newGroup && (
                        <tr className="bg-surface-muted/60">
                          <td colSpan={10} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                            {group}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="px-4 py-2 text-foreground">
                          <button
                            type="button"
                            onClick={() => setTrailFor({ productId: line.productId, productName: line.productName })}
                            title="Движение за день"
                            className="text-left underline decoration-dotted underline-offset-4 hover:text-accent"
                          >
                            {line.productName}
                          </button>
                          {line.consignment && <span className="ml-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">под реализацию</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">{formatQuantity(line.opening)}</td>
                        <td className="px-3 py-2 text-right text-muted">{line.received ? formatQuantity(line.received) : "—"}</td>
                        <td className="px-3 py-2 text-right text-muted">{line.sold ? formatQuantity(line.sold) : "—"}</td>
                        <td className="px-3 py-2 text-right text-muted">{line.returned ? formatQuantity(line.returned) : "—"}</td>
                        <td className="px-3 py-2 text-right text-muted">{line.other ? signedQuantity(line.other) : "—"}</td>
                        <td className="px-3 py-2 text-right font-medium text-foreground">
                          {formatQuantity(line.closing)} {UNIT_LABELS_RU[line.unit]}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            data-count-input
                            disabled={!!day.appliedAt}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              focusNextCount(e.currentTarget);
                            }}
                            value={counts[line.productId] ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setCounts((prev) => {
                                const next = { ...prev };
                                if (value === "") delete next[line.productId];
                                else next[line.productId] = value;
                                return next;
                              });
                              setIsDirty(true);
                            }}
                            className="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
                          />
                        </td>
                        <td className={clsx("px-3 py-2 text-right font-medium", signTone(d))}>{d === null ? "—" : signedQuantity(d)}</td>
                        <td className={clsx("px-4 py-2 text-right", signTone(d))}>{d === null ? "—" : signedMoney(Math.round(d * line.price * 100) / 100)}</td>
                      </tr>
                      </Fragment>
                    );
                  })}
                  {visibleLines.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-5 py-8 text-center text-sm text-muted">
                        {lines.length === 0 ? "За этот день на точке нет товаров и движений" : "Ничего не найдено"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-8">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Комментарий</label>
            <textarea value={note} onChange={(e) => edit(setNote)(e.target.value)} rows={2} className={inputClass} />
          </div>
        </>
      )}

      {trailFor && day && (
        <ProductTrailModal
          locationId={day.locationId}
          date={day.date}
          productId={trailFor.productId}
          productName={trailFor.productName}
          onClose={() => setTrailFor(null)}
        />
      )}

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Сохранённые сверки</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Дата</th>
              {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
              <th className="px-5 py-3 text-right font-medium">Деньги</th>
              <th className="px-5 py-3 text-right font-medium">Товар</th>
              <th className="px-5 py-3 text-right font-medium">Итог</th>
              <th className="px-5 py-3 font-medium">Сохранил</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {history.map((h) => (
              <tr
                key={`${h.locationId}-${h.date}`}
                onClick={() => {
                  if (isOrgWide) setLocationId(h.locationId);
                  setDate(h.date);
                }}
                className="cursor-pointer transition hover:bg-surface-muted"
              >
                <td className="px-5 py-3 text-foreground">{h.date.split("-").reverse().join(".")}</td>
                {isOrgWide && <td className="px-5 py-3 text-muted">{h.locationName}</td>}
                <td className={clsx("px-5 py-3 text-right", signTone(h.moneyDifference))}>{h.moneyDifference === null ? "—" : signedMoney(h.moneyDifference)}</td>
                <td className={clsx("px-5 py-3 text-right", signTone(h.goodsDifference))}>{h.goodsDifference === null ? "—" : signedMoney(h.goodsDifference)}</td>
                <td className={clsx("px-5 py-3 text-right font-medium", signTone(h.result))}>{h.result === null ? "—" : signedMoney(h.result)}</td>
                <td className="px-5 py-3 text-muted">{h.savedByName}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={isOrgWide ? 6 : 5} className="px-5 py-8 text-center text-sm text-muted">
                  Сохранённых сверок пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail, emphasis }: { label: string; value: number | null; detail?: string; emphasis?: boolean }) {
  return (
    <div className={clsx("rounded-2xl border bg-surface p-5 shadow-card", emphasis ? "border-accent/40" : "border-border")}>
      <p className={clsx("text-2xl font-semibold", signTone(value))}>{value === null ? "—" : signedMoney(value)}</p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}

function MoneyRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={clsx("flex items-center justify-between py-1.5 text-sm", strong && "border-t border-border pt-2.5 font-semibold")}>
      <span className={strong ? "text-foreground" : "text-muted"}>{label}</span>
      <span className="text-foreground">{formatMoney(value || 0)}</span>
    </div>
  );
}

function MoneyInputRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-36 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

function DifferenceRow({ value }: { value: number | null }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-2 text-sm font-semibold">
      <span className="text-foreground">Разница</span>
      <span className={signTone(value)}>{value === null ? "—" : signedMoney(value)}</span>
    </div>
  );
}
