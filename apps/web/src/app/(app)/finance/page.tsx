"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Banknote,
  Download,
  Landmark,
  Plus,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type {
  CashAccountDto,
  CashMovementDto,
  CustomerDto,
  ExpenseDto,
  FinanceCategoryDto,
  FinanceDashboardDto,
  InvoiceDto,
  LocationDto,
  ProfitAndLossDto,
} from "@bakery-os/shared";
import {
  CASH_ACCOUNT_MANAGE_ROLES,
  CASH_ACCOUNT_TYPE_LABELS_RU,
  CASH_MOVEMENT_INFLOW_TYPES,
  CASH_MOVEMENT_TYPE_LABELS_RU,
  CASH_REGISTER_MANAGE_ROLES,
  CashAccountType,
  CashMovementType,
  EXPENSE_MANAGE_ROLES,
  EXPENSE_STATUS_LABELS_RU,
  ExpenseStatus,
  FINANCE_CATEGORY_MANAGE_ROLES,
  FINANCE_VIEW_ROLES,
  FinanceCategoryKind,
  SUPPLIER_PAYMENT_ROLES,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { NewExpenseModal } from "@/components/new-expense-modal";
import { NewCashAccountModal } from "@/components/new-cash-account-modal";
import { CashMovementModal } from "@/components/cash-movement-modal";
import { CashTransferModal } from "@/components/cash-transfer-modal";
import { FinanceCategoryModal } from "@/components/finance-category-modal";
import { RecordDebtPaymentModal } from "@/components/record-debt-payment-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

type Tab = "overview" | "accounts" | "expenses" | "debts" | "pnl";
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

type DebtRow = {
  kind: "invoice" | "expense";
  id: string;
  label: string;
  counterparty: string;
  date: string;
  balanceDue: number;
};

export default function FinancePage() {
  const { user } = useAuth();
  const canView = user ? FINANCE_VIEW_ROLES.includes(user.role) : false;
  const canManageAccounts = user ? CASH_ACCOUNT_MANAGE_ROLES.includes(user.role) : false;
  const canManageCategories = user ? FINANCE_CATEGORY_MANAGE_ROLES.includes(user.role) : false;
  const canOperateCash = user ? CASH_REGISTER_MANAGE_ROLES.includes(user.role) : false;
  const canManageExpenses = user ? EXPENSE_MANAGE_ROLES.includes(user.role) : false;
  const canPaySuppliers = user ? SUPPLIER_PAYMENT_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>("30d");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");

  const [dashboard, setDashboard] = useState<FinanceDashboardDto | null>(null);
  const [pnl, setPnl] = useState<ProfitAndLossDto | null>(null);
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [showArchivedAccounts, setShowArchivedAccounts] = useState(false);
  const [movements, setMovements] = useState<CashMovementDto[]>([]);
  const [movementAccountFilter, setMovementAccountFilter] = useState("");
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [showArchivedCategories, setShowArchivedCategories] = useState(false);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [categoryModal, setCategoryModal] = useState<"new" | FinanceCategoryDto | null>(null);
  const [payingDebt, setPayingDebt] = useState<DebtRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(() => {
    api.finance.dashboard().then(setDashboard).catch(() => setError("Не удалось загрузить сводку"));
  }, []);

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

  const loadAccounts = useCallback(() => {
    api.finance.accounts
      .list(showArchivedAccounts)
      .then(setAccounts)
      .catch(() => setError("Не удалось загрузить счета"));
  }, [showArchivedAccounts]);

  const loadMovements = useCallback(() => {
    api.finance.movements
      .list(movementAccountFilter || undefined, 100)
      .then(setMovements)
      .catch(() => setError("Не удалось загрузить операции"));
  }, [movementAccountFilter]);

  const loadCategories = useCallback(() => {
    api.finance.categories
      .list(undefined, showArchivedCategories)
      .then(setCategories)
      .catch(() => setError("Не удалось загрузить категории"));
  }, [showArchivedCategories]);

  const loadDebts = useCallback(() => {
    api.customers.list().then(setCustomers).catch(() => {});
    api.invoices.list().then(setInvoices).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canView) return;
    api.locations.list().then(setLocations).catch(() => {});
    loadDashboard();
    loadAccounts();
    loadCategories();
    loadDebts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    if (canView) loadPnl();
  }, [canView, loadPnl]);

  useEffect(() => {
    if (canView) loadExpenses();
  }, [canView, loadExpenses]);

  useEffect(() => {
    if (canView) loadAccounts();
  }, [canView, loadAccounts]);

  useEffect(() => {
    if (canView) loadMovements();
  }, [canView, loadMovements]);

  useEffect(() => {
    if (canView) loadCategories();
  }, [canView, loadCategories]);

  function refreshAll() {
    loadDashboard();
    loadAccounts();
    loadMovements();
    loadExpenses();
    loadDebts();
    loadPnl();
  }

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

  async function handleArchiveAccount(account: CashAccountDto) {
    try {
      await api.finance.accounts.archive(account.id);
      loadAccounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать счёт");
    }
  }

  async function handleRestoreAccount(account: CashAccountDto) {
    try {
      await api.finance.accounts.restore(account.id);
      loadAccounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить счёт");
    }
  }

  async function handleSetDefaultAccount(account: CashAccountDto) {
    try {
      await api.finance.accounts.setDefault(account.id);
      loadAccounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось назначить основной счёт");
    }
  }

  async function handleArchiveCategory(category: FinanceCategoryDto) {
    try {
      await api.finance.categories.archive(category.id);
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать категорию");
    }
  }

  async function handleRestoreCategory(category: FinanceCategoryDto) {
    try {
      await api.finance.categories.restore(category.id);
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить категорию");
    }
  }

  async function handleConfirmExpense(expense: ExpenseDto) {
    try {
      await api.finance.confirmExpense(expense.id);
      loadExpenses();
      loadDebts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось подтвердить расход");
    }
  }

  async function handleCancelExpense(expense: ExpenseDto) {
    if (!confirm(`Отменить расход «${expense.description ?? expense.categoryName ?? ""}»?`)) return;
    try {
      await api.finance.cancelExpense(expense.id);
      loadExpenses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить расход");
    }
  }

  const activeAccounts = accounts.filter((a) => a.isActive);
  const bankAccounts = accounts.filter((a) => a.type === CashAccountType.BANK);
  const cashAccounts = accounts.filter((a) => a.type === CashAccountType.CASH);

  const debtorCustomers = customers.filter((c) => c.outstandingBalance > 0).sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  const totalReceivable = debtorCustomers.reduce((sum, c) => sum + c.outstandingBalance, 0);

  const payableRows: DebtRow[] = [
    ...invoices
      .filter((i) => i.balanceDue > 0)
      .map((i): DebtRow => ({
        kind: "invoice",
        id: i.id,
        label: `Накладная №${i.number}`,
        counterparty: i.supplierName,
        date: i.issuedAt,
        balanceDue: i.balanceDue,
      })),
    ...expenses
      .filter((e) => e.status === ExpenseStatus.CONFIRMED && e.balanceDue > 0)
      .map((e): DebtRow => ({
        kind: "expense",
        id: e.id,
        label: e.description || e.categoryName || "Расход",
        counterparty: e.categoryName ?? "—",
        date: e.incurredOn,
        balanceDue: e.balanceDue,
      })),
  ].sort((a, b) => b.balanceDue - a.balanceDue);
  const totalPayable = payableRows.reduce((sum, r) => sum + r.balanceDue, 0);

  async function submitDebtPayment(row: DebtRow, amount: number, accountId: string) {
    if (row.kind === "invoice") {
      await api.invoices.recordPayment(row.id, { amount, accountId });
    } else {
      await api.finance.recordExpensePayment(row.id, { amount, accountId });
    }
    setPayingDebt(null);
    loadDebts();
    loadExpenses();
    loadAccounts();
    loadMovements();
    loadDashboard();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Финансы</h1>
          <p className="mt-1 text-sm text-muted">Деньги, счета, P&amp;L и расходы</p>
        </div>
        {canOperateCash && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setMovementModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <Banknote className="h-4 w-4" strokeWidth={1.75} />
              Приход / расход
            </button>
            <button
              onClick={() => setTransferModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
              Перевод
            </button>
            {canManageExpenses && (
              <button
                onClick={() => setExpenseModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} />
                Новый расход
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Обзор
        </TabButton>
        <TabButton active={tab === "accounts"} onClick={() => setTab("accounts")}>
          Счета и операции
        </TabButton>
        <TabButton active={tab === "expenses"} onClick={() => setTab("expenses")}>
          Расходы
        </TabButton>
        <TabButton active={tab === "debts"} onClick={() => setTab("debts")}>
          Задолженности
        </TabButton>
        <TabButton active={tab === "pnl"} onClick={() => setTab("pnl")}>
          P&amp;L
        </TabButton>
      </div>

      {tab === "overview" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <StatCard icon={Wallet} label="Остаток денег" value={formatMoney(dashboard?.cashOnHand ?? 0)} />
            <StatCard icon={Landmark} label="На банковских счетах" value={formatMoney(dashboard?.bankBalance ?? 0)} />
            <StatCard icon={Banknote} label="В кассах" value={formatMoney(dashboard?.cashRegisterBalance ?? 0)} />
            <StatCard icon={TrendingUp} label="Поступления сегодня" value={formatMoney(dashboard?.todayInflow ?? 0)} />
            <StatCard icon={TrendingDown} label="Списания сегодня" value={formatMoney(dashboard?.todayOutflow ?? 0)} />
            <StatCard
              icon={TrendingUp}
              label="Нам должны"
              value={formatMoney(dashboard?.accountsReceivable ?? 0)}
              tone={dashboard && dashboard.accountsReceivable > 0 ? "warning" : "default"}
            />
            <StatCard
              icon={TrendingDown}
              label="Мы должны"
              value={formatMoney(dashboard?.accountsPayable ?? 0)}
              tone={dashboard && dashboard.accountsPayable > 0 ? "warning" : "default"}
            />
            <StatCard icon={Wallet} label="Валовая прибыль" value={formatMoney(dashboard?.grossProfit ?? 0)} />
            <StatCard
              icon={Wallet}
              label="Операционная прибыль"
              value={formatMoney(dashboard?.operatingProfit ?? 0)}
              tone={dashboard && dashboard.operatingProfit < 0 ? "danger" : "default"}
            />
            <StatCard
              icon={Wallet}
              label="Чистая прибыль"
              value={formatMoney(dashboard?.netProfit ?? 0)}
              tone={dashboard && dashboard.netProfit < 0 ? "danger" : "default"}
            />
          </div>
          <p className="mb-6 text-xs text-muted">
            Прибыль — с начала текущего месяца. Остальное — текущее состояние на сейчас.
          </p>

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Последние операции</h2>
            </div>
            <MovementsTable movements={movements.slice(0, 8)} />
          </div>
        </>
      )}

      {tab === "accounts" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Банковские счета</h2>
            {canManageAccounts && (
              <button
                onClick={() => setAccountModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} />
                Новый счёт
              </button>
            )}
          </div>
          <div className="mb-6 flex justify-end">
            <ArchivedToggle checked={showArchivedAccounts} onChange={setShowArchivedAccounts} />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {bankAccounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                canManage={canManageAccounts}
                onArchive={() => handleArchiveAccount(a)}
                onRestore={() => handleRestoreAccount(a)}
                onSetDefault={() => handleSetDefaultAccount(a)}
              />
            ))}
            {bankAccounts.length === 0 && <p className="text-sm text-muted">Банковских счетов пока нет</p>}
          </div>

          <h2 className="mb-4 text-sm font-semibold text-foreground">Кассы</h2>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cashAccounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                canManage={canManageAccounts}
                onArchive={() => handleArchiveAccount(a)}
                onRestore={() => handleRestoreAccount(a)}
              />
            ))}
            {cashAccounts.length === 0 && <p className="text-sm text-muted">Касс пока нет — создаётся автоматически при первой продаже</p>}
          </div>

          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Денежные операции</h2>
            <select
              value={movementAccountFilter}
              onChange={(e) => setMovementAccountFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Все счета</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <MovementsTable movements={movements} />
          </div>
        </>
      )}

      {tab === "expenses" && (
        <>
          {canManageCategories && (
            <div className="mb-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">Категории:</span>
                {categories
                  .filter((c) => c.kind === FinanceCategoryKind.EXPENSE)
                  .map((c) => (
                    <span
                      key={c.id}
                      className={clsx(
                        "flex items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1 text-xs font-medium",
                        !c.isActive && "opacity-50",
                      )}
                    >
                      <button onClick={() => setCategoryModal(c)} className="hover:underline">
                        {c.name}
                      </button>
                      {c.isActive ? (
                        <button
                          onClick={() => handleArchiveCategory(c)}
                          title="Архивировать"
                          className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition hover:bg-surface-muted hover:text-amber-600"
                        >
                          <Archive className="h-3 w-3" strokeWidth={1.75} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRestoreCategory(c)}
                          title="Восстановить"
                          className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition hover:bg-surface-muted hover:text-green-600"
                        >
                          <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
                        </button>
                      )}
                    </span>
                  ))}
              </div>
              <div className="flex items-center gap-2">
                <ArchivedToggle checked={showArchivedCategories} onChange={setShowArchivedCategories} />
                <button
                  onClick={() => setCategoryModal("new")}
                  className="flex items-center gap-1 rounded-xl border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Категория
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Категория</th>
                  <th className="px-5 py-3 font-medium">Точка</th>
                  <th className="px-5 py-3 font-medium">Описание</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 text-right font-medium">Сумма</th>
                  <th className="px-5 py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-3 text-muted">{formatDateTime(e.incurredOn)}</td>
                    <td className="px-5 py-3 text-foreground">{e.categoryName ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{e.locationName ?? "Вся сеть"}</td>
                    <td className="px-5 py-3 text-muted">{e.description ?? "—"}</td>
                    <td className="px-5 py-3">
                      <ExpenseStatusBadge expense={e} />
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(e.amount)}</td>
                    <td className="px-5 py-3 text-right">
                      {canManageExpenses && e.status === ExpenseStatus.DRAFT && (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleConfirmExpense(e)}
                            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-surface-muted"
                          >
                            Подтвердить
                          </button>
                          <button
                            onClick={() => handleCancelExpense(e)}
                            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                          >
                            Отменить
                          </button>
                        </div>
                      )}
                      {canManageExpenses && e.status === ExpenseStatus.CONFIRMED && e.balanceDue > 0 && (
                        <button
                          onClick={() =>
                            setPayingDebt({
                              kind: "expense",
                              id: e.id,
                              label: e.description || e.categoryName || "Расход",
                              counterparty: e.categoryName ?? "—",
                              date: e.incurredOn,
                              balanceDue: e.balanceDue,
                            })
                          }
                          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90"
                        >
                          Оплатить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                      Расходов пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "debts" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Дебиторская задолженность</h2>
              <span className="text-sm font-semibold text-foreground">{formatMoney(totalReceivable)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {debtorCustomers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-3 text-foreground">{c.name}</td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(c.outstandingBalance)}</td>
                  </tr>
                ))}
                {debtorCustomers.length === 0 && (
                  <tr>
                    <td className="px-5 py-8 text-center text-sm text-muted">Нам никто не должен</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Кредиторская задолженность</h2>
              <span className="text-sm font-semibold text-foreground">{formatMoney(totalPayable)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {payableRows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td className="px-5 py-3">
                      <p className="text-foreground">{r.label}</p>
                      <p className="text-xs text-muted">{r.counterparty}</p>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(r.balanceDue)}</td>
                    <td className="px-5 py-3 text-right">
                      {canPaySuppliers && (
                        <button
                          onClick={() => setPayingDebt(r)}
                          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90"
                        >
                          Оплатить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {payableRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-sm text-muted">
                      Мы никому не должны
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "pnl" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                  {PERIOD_LABELS[p]}
                </TabButton>
              ))}
            </div>
            <div className="flex items-center gap-2">
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
              <button
                onClick={exportPnlCsv}
                disabled={!pnl}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
              >
                <Download className="h-4 w-4" strokeWidth={1.75} />
                CSV
              </button>
            </div>
          </div>

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
              label="Операционная прибыль"
              value={formatMoney(pnl?.operatingProfit ?? 0)}
              tone={pnl && pnl.operatingProfit < 0 ? "danger" : "default"}
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

      {expenseModalOpen && (
        <NewExpenseModal
          locations={locations}
          onClose={() => setExpenseModalOpen(false)}
          onCreated={() => {
            setExpenseModalOpen(false);
            refreshAll();
          }}
        />
      )}

      {accountModalOpen && (
        <NewCashAccountModal
          locations={locations}
          onClose={() => setAccountModalOpen(false)}
          onCreated={() => {
            setAccountModalOpen(false);
            loadAccounts();
          }}
        />
      )}

      {movementModalOpen && (
        <CashMovementModal
          accounts={activeAccounts}
          onClose={() => setMovementModalOpen(false)}
          onSaved={() => {
            setMovementModalOpen(false);
            loadAccounts();
            loadMovements();
            loadDashboard();
          }}
        />
      )}

      {transferModalOpen && (
        <CashTransferModal
          accounts={activeAccounts}
          onClose={() => setTransferModalOpen(false)}
          onSaved={() => {
            setTransferModalOpen(false);
            loadAccounts();
            loadMovements();
            loadDashboard();
          }}
        />
      )}

      {categoryModal && (
        <FinanceCategoryModal
          category={categoryModal === "new" ? undefined : categoryModal}
          onClose={() => setCategoryModal(null)}
          onSaved={() => {
            setCategoryModal(null);
            loadCategories();
          }}
        />
      )}

      {payingDebt && (
        <RecordDebtPaymentModal
          title={`Оплата: ${payingDebt.label}`}
          balanceDue={payingDebt.balanceDue}
          accounts={activeAccounts}
          onClose={() => setPayingDebt(null)}
          onSubmit={(amount, accountId) => submitDebtPayment(payingDebt, amount, accountId)}
        />
      )}
    </div>
  );
}

function MovementsTable({ movements }: { movements: CashMovementDto[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <th className="px-5 py-3 font-medium">Дата</th>
          <th className="px-5 py-3 font-medium">Счёт</th>
          <th className="px-5 py-3 font-medium">Тип</th>
          <th className="px-5 py-3 font-medium">Комментарий</th>
          <th className="px-5 py-3 text-right font-medium">Сумма</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {movements.map((m) => {
          const isAdjustment = m.type === CashMovementType.ADJUSTMENT;
          const isInflow = isAdjustment ? m.amount >= 0 : CASH_MOVEMENT_INFLOW_TYPES.includes(m.type);
          return (
            <tr key={m.id}>
              <td className="px-5 py-3 text-muted">{formatDateTime(m.occurredAt)}</td>
              <td className="px-5 py-3 text-foreground">{m.accountName}</td>
              <td className="px-5 py-3 text-muted">{CASH_MOVEMENT_TYPE_LABELS_RU[m.type]}</td>
              <td className="px-5 py-3 text-muted">
                {m.categoryName ?? m.customerName ?? m.supplierName ?? m.reason ?? "—"}
              </td>
              <td
                className={clsx(
                  "px-5 py-3 text-right font-medium",
                  isInflow ? "text-emerald-600" : "text-red-600",
                )}
              >
                {isInflow ? "+" : "−"}
                {formatMoney(Math.abs(m.amount))}
              </td>
            </tr>
          );
        })}
        {movements.length === 0 && (
          <tr>
            <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
              Операций пока нет
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function AccountCard({
  account,
  canManage,
  onArchive,
  onRestore,
  onSetDefault,
}: {
  account: CashAccountDto;
  canManage: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onSetDefault?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div>
        <p className="flex items-center gap-2 font-medium text-foreground">
          {account.name}
          {account.isDefault && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Основной</span>
          )}
          {!account.isActive && <ArchivedBadge />}
        </p>
        <p className="mt-1 text-xs text-muted">
          {CASH_ACCOUNT_TYPE_LABELS_RU[account.type]}
          {account.locationName ? ` · ${account.locationName}` : ""}
        </p>
        <p className="mt-2 text-lg font-semibold text-foreground">{formatMoney(account.currentBalance)}</p>
      </div>
      {canManage && (
        <div className="flex flex-col items-end gap-2">
          {onSetDefault && !account.isDefault && account.isActive && (
            <button onClick={onSetDefault} className="text-xs font-medium text-accent hover:opacity-80">
              Сделать основным
            </button>
          )}
          <RowActions isActive={account.isActive} onEdit={undefined} onArchive={onArchive} onRestore={onRestore} />
        </div>
      )}
    </div>
  );
}

function ExpenseStatusBadge({ expense }: { expense: ExpenseDto }) {
  const styles: Record<ExpenseStatus, string> = {
    [ExpenseStatus.DRAFT]: "bg-surface-muted text-muted",
    [ExpenseStatus.CONFIRMED]: expense.balanceDue > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700",
    [ExpenseStatus.CANCELLED]: "bg-red-50 text-red-700",
  };
  const label =
    expense.status === ExpenseStatus.CONFIRMED
      ? expense.balanceDue > 0
        ? "Не оплачен"
        : "Оплачен"
      : EXPENSE_STATUS_LABELS_RU[expense.status];
  return <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", styles[expense.status])}>{label}</span>;
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
  tone?: "default" | "danger" | "warning";
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div
        className={clsx(
          "mb-3 flex h-9 w-9 items-center justify-center rounded-xl",
          tone === "danger" ? "bg-red-50 text-red-600" : tone === "warning" ? "bg-amber-50 text-amber-600" : "bg-surface-muted text-accent",
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <p
        className={clsx(
          "text-2xl font-semibold",
          tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-foreground",
        )}
      >
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
