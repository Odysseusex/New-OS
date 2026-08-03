"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Download, Plus, ShieldAlert, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { ExpenseDto, LocationDto, ProfitAndLossDto } from "@bakery-os/shared";
import { EXPENSE_CATEGORY_LABELS_RU, FINANCE_VIEW_ROLES } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { NewExpenseModal } from "@/components/new-expense-modal";

type Tab = "pnl" | "expenses";
type Period = "today" | "7d" | "30d" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
};

function periodRange(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);

  if (period === "7d") from.setDate(from.getDate() - 6);
  if (period === "30d") from.setDate(from.getDate() - 29);
  if (period === "month") from.setDate(1);

  return { from, to };
}

export default function FinancePage() {
  const { user } = useAuth();
  const canView = user ? FINANCE_VIEW_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("pnl");
  const [period, setPeriod] = useState<Period>("30d");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [pnl, setPnl] = useState<ProfitAndLossDto | null>(null);
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPnl = useCallback(() => {
    const { from, to } = periodRange(period);
    api.finance
      .pnl(from.toISOString(), to.toISOString(), locationFilter || undefined)
      .then(setPnl)
      .catch(() => setError("Не удалось загрузить P&L"));
  }, [period, locationFilter]);

  const loadExpenses = useCallback(() => {
    api.finance
      .expenses(locationFilter || undefined)
      .then(setExpenses)
      .catch(() => setError("Не удалось загрузить расходы"));
  }, [locationFilter]);

  useEffect(() => {
    if (!canView) return;
    api.locations.list().then(setLocations).catch(() => {});
  }, [canView]);

  useEffect(() => {
    if (canView) loadPnl();
  }, [canView, loadPnl]);

  useEffect(() => {
    if (canView) loadExpenses();
  }, [canView, loadExpenses]);

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} />
        <h1 className="text-lg font-semibold text-foreground">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted">
          Финансовые показатели доступны владельцу, администратору, региональному
          директору и бухгалтеру.
        </p>
      </div>
    );
  }

  function exportPnlCsv() {
    if (!pnl) return;
    downloadCsv(
      `pnl-${period}.csv`,
      ["Товар", "Продано", "Выручка", "Себестоимость", "Валовая прибыль", "Маржа %"],
      pnl.byProduct.map((p) => [
        p.productName,
        formatQuantity(p.quantitySold),
        p.revenue.toFixed(2),
        p.hasCostData ? p.cogs.toFixed(2) : "нет данных",
        p.grossProfit.toFixed(2),
        p.marginPercent !== null ? p.marginPercent.toFixed(1) : "—",
      ]),
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Финансы</h1>
          <p className="mt-1 text-sm text-muted">P&L, себестоимость и расходы</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <TabButton active={tab === "pnl"} onClick={() => setTab("pnl")}>
            P&amp;L
          </TabButton>
          <TabButton active={tab === "expenses"} onClick={() => setTab("expenses")}>
            Расходы
          </TabButton>
        </div>

        <div className="flex items-center gap-2">
          {tab === "pnl" && (
            <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                  {PERIOD_LABELS[p]}
                </TabButton>
              ))}
            </div>
          )}
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Вся сеть</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          {tab === "pnl" && (
            <button
              onClick={exportPnlCsv}
              disabled={!pnl}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
            >
              <Download className="h-4 w-4" strokeWidth={1.75} />
              CSV
            </button>
          )}
          {tab === "expenses" && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый расход
            </button>
          )}
        </div>
      </div>

      {tab === "pnl" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatCard icon={TrendingUp} label="Выручка" value={formatMoney(pnl?.revenue ?? 0)} />
            <StatCard icon={TrendingDown} label="Себестоимость" value={formatMoney(pnl?.cogs ?? 0)} />
            <StatCard
              icon={Wallet}
              label={`Валовая прибыль${pnl?.grossMarginPercent != null ? ` (${pnl.grossMarginPercent.toFixed(0)}%)` : ""}`}
              value={formatMoney(pnl?.grossProfit ?? 0)}
            />
            <StatCard icon={TrendingDown} label="Расходы" value={formatMoney(pnl?.expensesTotal ?? 0)} />
            <StatCard
              icon={Wallet}
              label="Чистая прибыль"
              value={formatMoney(pnl?.netProfit ?? 0)}
              tone={pnl && pnl.netProfit < 0 ? "danger" : "default"}
            />
          </div>

          {pnl && pnl.unknownCostLineItems > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {pnl.unknownCostLineItems}{" "}
              {pnl.unknownCostLineItems === 1 ? "позиция продаж" : "позиций продаж"} без данных о
              себестоимости (нет рецептуры и истории закупок) — маржа по ним завышена.
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">P&amp;L по товарам</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Товар</th>
                  <th className="px-5 py-3 text-right font-medium">Продано</th>
                  <th className="px-5 py-3 text-right font-medium">Выручка</th>
                  <th className="px-5 py-3 text-right font-medium">Себестоимость</th>
                  <th className="px-5 py-3 text-right font-medium">Валовая прибыль</th>
                  <th className="px-5 py-3 text-right font-medium">Маржа</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pnl?.byProduct.map((p) => (
                  <tr key={p.productId}>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {p.productName}
                      {!p.hasCostData && (
                        <span className="ml-1.5 text-xs font-normal text-amber-600">без себестоимости</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-muted">{formatQuantity(p.quantitySold)}</td>
                    <td className="px-5 py-3 text-right text-foreground">{formatMoney(p.revenue)}</td>
                    <td className="px-5 py-3 text-right text-muted">
                      {p.hasCostData ? formatMoney(p.cogs) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">
                      {formatMoney(p.grossProfit)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted">
                      {p.marginPercent !== null ? `${p.marginPercent.toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
                {(!pnl || pnl.byProduct.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                      Продаж за этот период нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "expenses" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Категория</th>
                <th className="px-5 py-3 font-medium">Точка</th>
                <th className="px-5 py-3 font-medium">Описание</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="px-5 py-3 text-muted">{formatDateTime(e.incurredOn)}</td>
                  <td className="px-5 py-3 text-foreground">{EXPENSE_CATEGORY_LABELS_RU[e.category]}</td>
                  <td className="px-5 py-3 text-muted">{e.locationName ?? "Вся сеть"}</td>
                  <td className="px-5 py-3 text-muted">{e.description ?? "—"}</td>
                  <td className="px-5 py-3 text-right font-medium text-foreground">
                    {formatMoney(e.amount)}
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                    Расходов пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <NewExpenseModal
          locations={locations}
          onClose={() => setIsModalOpen(false)}
          onCreated={() => {
            setIsModalOpen(false);
            loadExpenses();
            loadPnl();
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div
        className={clsx(
          "mb-3 flex h-9 w-9 items-center justify-center rounded-xl",
          tone === "danger" ? "bg-red-50 text-red-600" : "bg-surface-muted text-accent",
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <p className={clsx("text-2xl font-semibold", tone === "danger" ? "text-red-600" : "text-foreground")}>
        {value}
      </p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
