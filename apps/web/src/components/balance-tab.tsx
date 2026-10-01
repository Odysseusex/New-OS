"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { BALANCE_STATUS_LABELS_RU, BalanceStatus } from "@bakery-os/shared";
import type { BalanceSectionDto, BalanceSheetDto, InventoryRollForwardDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney, formatQuantity } from "@/lib/format";

const STATUS_STYLES: Record<BalanceStatus, string> = {
  [BalanceStatus.BALANCED]: "bg-green-50 text-green-700",
  [BalanceStatus.NOT_BALANCED]: "bg-red-50 text-red-700",
  [BalanceStatus.NOT_AVAILABLE]: "bg-surface-muted text-muted",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

// Assets and liabilities are what the ledgers hold; equity is built from its
// own history. If the two sides disagree the statement says so and the reasons
// are listed in the Контроль block below — they are not part of any total.
export function BalanceTab() {
  const [asOf, setAsOf] = useState(todayIso());
  const [sheet, setSheet] = useState<BalanceSheetDto | null>(null);
  const [roll, setRoll] = useState<InventoryRollForwardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const isToday = asOf === todayIso();
    // End of the chosen day, in the browser's zone; "today" means "now".
    const end = isToday ? new Date() : new Date(`${asOf}T23:59:59.999`);
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    Promise.all([api.finance.balance(end.toISOString()), api.finance.inventoryRollForward(start.toISOString(), end.toISOString())])
      .then(([b, r]) => {
        setSheet(b);
        setRoll(r);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить баланс"));
  }, [asOf]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!sheet) return <p className="text-sm text-muted">Загрузка…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={asOf}
          max={todayIso()}
          onChange={(e) => setAsOf(e.target.value || todayIso())}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <span className={clsx("rounded-full px-3 py-1 text-sm font-medium", STATUS_STYLES[sheet.status])}>
          {BALANCE_STATUS_LABELS_RU[sheet.status]}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Column title="Активы" section={sheet.assets} />
        <Column title="Обязательства" section={sheet.liabilities} />
        <Column
          title="Капитал"
          section={sheet.equity}
          extra={[{ label: "Накопленный финансовый результат", amount: sheet.equity.accumulatedResult }]}
        />
      </div>

      {(sheet.control.lines.length > 0 || sheet.control.notes.length > 0 || sheet.status === BalanceStatus.NOT_BALANCED) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
            Контроль
          </h3>
          {sheet.status !== BalanceStatus.NOT_AVAILABLE && (
            <p className="mb-3 text-sm text-amber-900">
              Активы − Обязательства − Капитал: <span className="font-semibold">{formatMoney(sheet.control.difference)}</span>
            </p>
          )}
          {sheet.control.lines.length > 0 && (
            <table className="mb-3 w-full text-sm">
              <thead>
                <tr className="border-b border-amber-200 text-left text-xs uppercase tracking-wide text-amber-800">
                  <th className="py-1.5 font-medium">Статья</th>
                  <th className="py-1.5 text-right font-medium">Факт</th>
                  <th className="py-1.5 text-right font-medium">По событиям</th>
                  <th className="py-1.5 text-right font-medium">Влияние</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-200 text-amber-900">
                {sheet.control.lines.map((l) => (
                  <tr key={l.label}>
                    <td className="py-1.5">{l.label}</td>
                    <td className="py-1.5 text-right">{l.actual === null ? "—" : formatMoney(l.actual)}</td>
                    <td className="py-1.5 text-right">{l.projected === null ? "—" : formatMoney(l.projected)}</td>
                    <td className="py-1.5 text-right font-medium">{formatMoney(l.effect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sheet.control.notes.map((n) => (
            <p key={n} className="text-sm text-amber-900">
              {n}
            </p>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Оценка запасов: {sheet.costingMethod}</p>

      {roll && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Оборот запасов за месяц</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Статья</th>
                <th className="px-5 py-3 text-right font-medium">Количество</th>
                <th className="px-5 py-3 text-right font-medium">Стоимость</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="bg-surface-muted font-medium">
                <td className="px-5 py-2.5">Остаток на начало</td>
                <td className="px-5 py-2.5 text-right">{formatQuantity(roll.opening.quantity)}</td>
                <td className="px-5 py-2.5 text-right">{formatMoney(roll.opening.value)}</td>
              </tr>
              {roll.movements.map((m) => (
                <tr key={m.key}>
                  <td className="px-5 py-2.5 text-muted">{m.label}</td>
                  <td className="px-5 py-2.5 text-right">{formatQuantity(m.quantity)}</td>
                  <td className="px-5 py-2.5 text-right">{formatMoney(m.value)}</td>
                </tr>
              ))}
              <tr className="bg-surface-muted font-medium">
                <td className="px-5 py-2.5">Остаток на конец (расчёт)</td>
                <td className="px-5 py-2.5 text-right">{formatQuantity(roll.closingComputed.quantity)}</td>
                <td className="px-5 py-2.5 text-right">{formatMoney(roll.closingComputed.value)}</td>
              </tr>
              {roll.closingActual && (
                <tr>
                  <td className="px-5 py-2.5 text-muted">Остаток на конец (склад)</td>
                  <td className="px-5 py-2.5 text-right">{formatQuantity(roll.closingActual.quantity)}</td>
                  <td className="px-5 py-2.5 text-right">{formatMoney(roll.closingActual.value)}</td>
                </tr>
              )}
              {roll.difference && (
                <tr className={clsx(!roll.reconciles && "text-amber-800")}>
                  <td className="px-5 py-2.5">Расхождение</td>
                  <td className="px-5 py-2.5 text-right">{formatQuantity(roll.difference.quantity)}</td>
                  <td className="px-5 py-2.5 text-right">{formatMoney(roll.difference.value)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Column({ title, section, extra }: { title: string; section: BalanceSectionDto; extra?: { label: string; amount: number }[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">{title}</div>
      <ul className="divide-y divide-border text-sm">
        {section.lines.map((l) => (
          <li key={l.line} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span className="text-muted">{l.label}</span>
            <span className="tabular-nums text-foreground">{formatMoney(l.amount)}</span>
          </li>
        ))}
        {extra?.map((l) => (
          <li key={l.label} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span className="text-muted">{l.label}</span>
            <span className="tabular-nums text-foreground">{formatMoney(l.amount)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 bg-surface-muted px-5 py-2.5 font-semibold">
          <span>Итого</span>
          <span className="tabular-nums">{formatMoney(section.total)}</span>
        </li>
      </ul>
    </div>
  );
}
