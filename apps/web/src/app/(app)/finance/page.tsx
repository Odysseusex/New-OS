"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Download,
  Landmark,
  Plus,
  RotateCcw,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type {
  BreakEvenDto,
  PlannedBreakEvenDto,
  PlannedFixedCostDto,
  CashAccountDto,
  CashMovementDto,
  CustomerDto,
  ExpenseDto,
  FinanceCategoryDto,
  FinanceDashboardDto,
  FinanceSetupStatusDto,
  InvoiceDto,
  LocationDto,
  ProfitAndLossDto,
} from "@bakery-os/shared";
import {
  BREAK_EVEN_STATUS_LABELS_RU,
  BreakEvenStatus,
  COMPENSATION_TYPE_LABELS_RU,
  PAYROLL_EXCLUSION_REASON_LABELS_RU,
  PLANNED_FIXED_COST_MANAGE_ROLES,
  PayrollExclusionReason,
  CASH_ACCOUNT_MANAGE_ROLES,
  CASH_ACCOUNT_TYPE_LABELS_RU,
  CASH_MOVEMENT_INFLOW_TYPES,
  CASH_MOVEMENT_TYPE_LABELS_RU,
  CASH_REGISTER_MANAGE_ROLES,
  CashAccountType,
  CashMovementType,
  COST_BEHAVIOR_LABELS_RU,
  CostBehavior,
  EXPENSE_MANAGE_ROLES,
  ExpenseStatus,
  FINANCE_CATEGORY_MANAGE_ROLES,
  FINANCE_SETUP_ROLES,
  FINANCE_VIEW_ROLES,
  FinanceCategoryKind,
  PAYMENT_STATUS_LABELS_RU,
  PaymentStatus,
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
import { PlannedFixedCostModal } from "@/components/planned-fixed-cost-modal";
import { RecordDebtPaymentModal } from "@/components/record-debt-payment-modal";
import { RowActions } from "@/components/row-actions";

type Tab =
  | "summary"
  | "bank"
  | "cashflow"
  | "receivables"
  | "payables"
  | "expenses"
  | "categories"
  | "pnl"
  | "breakeven";
type Period = "today" | "7d" | "30d" | "month";

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Сводка" },
  { id: "bank", label: "Банк и касса" },
  { id: "cashflow", label: "ДДС" },
  { id: "receivables", label: "Дебиторская задолженность" },
  { id: "payables", label: "Кредиторская задолженность" },
  { id: "expenses", label: "Расходы" },
  { id: "categories", label: "Статьи ДДС" },
  { id: "pnl", label: "Прибыли и убытки" },
  { id: "breakeven", label: "Точка безубыточности" },
];

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

// Every non-OK status means the number is intentionally withheld rather than
// shown wrong (see BreakEvenStatus in packages/shared/src/finance.ts).
function breakEvenStatusMessage(status: BreakEvenStatus): string {
  switch (status) {
    case BreakEvenStatus.NO_SALES:
      return "За выбранный период отсутствует выручка — маржинальность не определена, точка безубыточности не рассчитывается.";
    case BreakEvenStatus.NO_FIXED_COSTS_CLASSIFIED:
      return "Ни одна статья затрат не классифицирована как постоянная — укажите тип затрат на вкладке «Статьи ДДС».";
    case BreakEvenStatus.NEGATIVE_MARGIN:
      return "Переменные затраты превышают выручку — маржинальная прибыль отрицательна, точка безубыточности не существует.";
    default:
      return BREAK_EVEN_STATUS_LABELS_RU[status];
  }
}

// Same honest-withholding rule as the actual break-even, but the reasons
// differ: here the missing input is the PLAN, not the classification.
function plannedBreakEvenStatusMessage(status: BreakEvenStatus): string {
  switch (status) {
    case BreakEvenStatus.NO_SALES:
      return "За выбранный период отсутствует выручка — маржинальность не определена, плановая точка безубыточности не рассчитывается.";
    case BreakEvenStatus.NO_PLANNED_FIXED_COSTS:
      return "Плановые постоянные затраты не заданы — укажите оклады сотрудников в разделе «Персонал» и плановые затраты в таблице ниже.";
    case BreakEvenStatus.NEGATIVE_MARGIN:
      return "Переменные затраты превышают выручку — маржинальная прибыль отрицательна, плановые постоянные затраты не покрываются ни при каком объёме продаж.";
    default:
      return BREAK_EVEN_STATUS_LABELS_RU[status];
  }
}

type PayableRow = {
  kind: "invoice" | "expense";
  id: string;
  label: string;
  counterparty: string;
  date: string;
  balanceDue: number;
  paymentStatus: PaymentStatus;
};

export default function FinancePage() {
  const { user } = useAuth();
  const canView = user ? FINANCE_VIEW_ROLES.includes(user.role) : false;
  const canManageAccounts = user ? CASH_ACCOUNT_MANAGE_ROLES.includes(user.role) : false;
  const canManageCategories = user ? FINANCE_CATEGORY_MANAGE_ROLES.includes(user.role) : false;
  const canManagePlannedCosts = user ? PLANNED_FIXED_COST_MANAGE_ROLES.includes(user.role) : false;
  const canOperateCash = user ? CASH_REGISTER_MANAGE_ROLES.includes(user.role) : false;
  const canManageExpenses = user ? EXPENSE_MANAGE_ROLES.includes(user.role) : false;
  const canPaySuppliers = user ? SUPPLIER_PAYMENT_ROLES.includes(user.role) : false;
  const canRunSetup = user ? FINANCE_SETUP_ROLES.includes(user.role) : false;

  const [setupStatus, setSetupStatus] = useState<FinanceSetupStatusDto | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [period, setPeriod] = useState<Period>("month");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");

  const [dashboard, setDashboard] = useState<FinanceDashboardDto | null>(null);
  const [pnl, setPnl] = useState<ProfitAndLossDto | null>(null);
  const [breakEven, setBreakEven] = useState<BreakEvenDto | null>(null);
  // Плановая («что мы запланировали») vs фактическая («что реально
  // произошло») точка безубыточности — две отдельные цифры, никогда не
  // складываются друг с другом.
  const [breakEvenMode, setBreakEvenMode] = useState<"fact" | "plan">("fact");
  const [plannedBreakEven, setPlannedBreakEven] = useState<PlannedBreakEvenDto | null>(null);
  const [plannedFixedCosts, setPlannedFixedCosts] = useState<PlannedFixedCostDto[]>([]);
  const [plannedCostModalOpen, setPlannedCostModalOpen] = useState(false);
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
  const [categoryModal, setCategoryModal] = useState<"income" | "expense" | FinanceCategoryDto | null>(null);
  const [payingDebt, setPayingDebt] = useState<PayableRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(() => {
    const { from, to } = periodRange(period);
    api.finance
      .dashboard(from.toISOString(), to.toISOString())
      .then(setDashboard)
      .catch(() => setError("Не удалось загрузить сводку"));
  }, [period]);

  const loadPnl = useCallback(() => {
    const { from, to } = periodRange(period);
    api.finance
      .pnl(from.toISOString(), to.toISOString(), locationFilter || undefined)
      .then(setPnl)
      .catch(() => setError("Не удалось загрузить отчёт"));
  }, [period, locationFilter]);

  const loadBreakEven = useCallback(() => {
    const { from, to } = periodRange(period);
    api.finance
      .breakEven(from.toISOString(), to.toISOString(), locationFilter || undefined)
      .then(setBreakEven)
      .catch(() => setError("Не удалось загрузить точку безубыточности"));
  }, [period, locationFilter]);

  const loadPlannedBreakEven = useCallback(() => {
    const { from, to } = periodRange(period);
    api.finance
      .plannedBreakEven(from.toISOString(), to.toISOString(), locationFilter || undefined)
      .then(setPlannedBreakEven)
      .catch(() => setError("Не удалось загрузить плановую точку безубыточности"));
  }, [period, locationFilter]);

  const loadPlannedFixedCosts = useCallback(() => {
    api.finance.plannedFixedCosts
      .list()
      .then(setPlannedFixedCosts)
      .catch(() => setError("Не удалось загрузить плановые расходы"));
  }, []);

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
      .list(movementAccountFilter || undefined, 150)
      .then(setMovements)
      .catch(() => setError("Не удалось загрузить движение денежных средств"));
  }, [movementAccountFilter]);

  const loadCategories = useCallback(() => {
    api.finance.categories
      .list(undefined, showArchivedCategories)
      .then(setCategories)
      .catch(() => setError("Не удалось загрузить статьи ДДС"));
  }, [showArchivedCategories]);

  const loadDebts = useCallback(() => {
    api.customers.list().then(setCustomers).catch(() => {});
    api.invoices.list().then(setInvoices).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canView) return;
    api.locations.list().then(setLocations).catch(() => {});
    loadAccounts();
    loadCategories();
    loadDebts();
    if (canRunSetup) {
      api.finance.setup.status().then(setSetupStatus).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canRunSetup]);

  useEffect(() => {
    if (canView) loadDashboard();
  }, [canView, loadDashboard]);

  useEffect(() => {
    if (canView) loadPnl();
  }, [canView, loadPnl]);

  useEffect(() => {
    if (canView) loadBreakEven();
  }, [canView, loadBreakEven]);

  useEffect(() => {
    if (canView) loadPlannedBreakEven();
  }, [canView, loadPlannedBreakEven]);

  useEffect(() => {
    if (canView) loadPlannedFixedCosts();
  }, [canView, loadPlannedFixedCosts]);

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
    loadBreakEven();
    loadPlannedBreakEven();
  }

  async function handleClosePlannedFixedCost(row: PlannedFixedCostDto) {
    if (!confirm(`Убрать плановый расход «${row.categoryName}»? История сохранится.`)) return;
    try {
      await api.finance.plannedFixedCosts.close(row.id);
      loadPlannedFixedCosts();
      loadPlannedBreakEven();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось убрать плановый расход");
    }
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
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать статью");
    }
  }

  async function handleSetCostBehavior(category: FinanceCategoryDto, costBehavior: CostBehavior) {
    try {
      await api.finance.categories.setCostBehavior(category.id, costBehavior);
      loadCategories();
      loadBreakEven();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить тип статьи");
    }
  }

  async function handleRestoreCategory(category: FinanceCategoryDto) {
    try {
      await api.finance.categories.restore(category.id);
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить статью");
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

  const debtorCustomers = customers
    .filter((c) => c.outstandingBalance > 0)
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  const totalReceivable = debtorCustomers.reduce((sum, c) => sum + c.outstandingBalance, 0);

  const payableRows: PayableRow[] = [
    ...invoices
      .filter((i) => i.balanceDue > 0)
      .map((i): PayableRow => ({
        kind: "invoice",
        id: i.id,
        label: `Накладная №${i.number}`,
        counterparty: i.supplierName,
        date: i.issuedAt,
        balanceDue: i.balanceDue,
        paymentStatus: i.paymentStatus,
      })),
    ...expenses
      .filter((e) => e.status === ExpenseStatus.CONFIRMED && e.balanceDue > 0)
      .map((e): PayableRow => ({
        kind: "expense",
        id: e.id,
        label: e.description || e.categoryName || "Расход",
        counterparty: e.categoryName ?? "—",
        date: e.incurredOn,
        balanceDue: e.balanceDue,
        paymentStatus: e.paymentStatus,
      })),
  ].sort((a, b) => b.balanceDue - a.balanceDue);
  const totalPayable = payableRows.reduce((sum, r) => sum + r.balanceDue, 0);

  function daysSince(dateIso: string): number {
    return Math.max(0, Math.floor((Date.now() - new Date(dateIso).getTime()) / 86400000));
  }

  async function submitDebtPayment(row: PayableRow, amount: number, accountId: string) {
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
          <p className="mt-1 text-sm text-muted">Денежные средства, расчёты с контрагентами и финансовый результат</p>
        </div>
        {canOperateCash && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setMovementModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <Banknote className="h-4 w-4" strokeWidth={1.75} />
              Новая операция
            </button>
            <button
              onClick={() => setTransferModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
              Новый перевод
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

      {canRunSetup && setupStatus && !setupStatus.initialized && (
        <Link
          href="/finance/setup"
          className="mb-6 flex items-center justify-between rounded-2xl border border-accent/30 bg-accent/5 px-5 py-4 text-sm transition hover:bg-accent/10"
        >
          <div>
            <p className="font-medium text-foreground">Финансовый учёт ещё не запущен</p>
            <p className="mt-0.5 text-muted">
              Склад, продажи и производство уже ведутся — зафиксируйте начальное финансовое состояние
              компании, чтобы остатки и отчёты были верными.
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1 pl-4 font-medium text-accent">
            Запустить
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </span>
        </Link>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
        {TABS.map((t) => (
          <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </TabButton>
        ))}
      </div>

      {tab === "summary" && (
        <>
          <div className="mb-5 flex items-center justify-between">
            <p className="text-xs text-muted">
              Остатки и расчёты — на текущий момент. Финансовый результат — за период ниже.
            </p>
            <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                  {PERIOD_LABELS[p]}
                </TabButton>
              ))}
            </div>
          </div>

          <SummarySection title="Денежные средства">
            <StatCard icon={Wallet} label="Остаток денежных средств" value={formatMoney(dashboard?.cashOnHand ?? 0)} />
            <StatCard icon={Landmark} label="Банковские счета" value={formatMoney(dashboard?.bankBalance ?? 0)} />
            <StatCard icon={Banknote} label="Кассы" value={formatMoney(dashboard?.cashRegisterBalance ?? 0)} />
          </SummarySection>

          <SummarySection title="Движение за сегодня">
            <StatCard icon={TrendingUp} label="Поступления" value={formatMoney(dashboard?.todayInflow ?? 0)} />
            <StatCard icon={TrendingDown} label="Списания" value={formatMoney(dashboard?.todayOutflow ?? 0)} />
            <StatCard
              icon={Wallet}
              label="Чистое изменение"
              value={formatMoney((dashboard?.todayInflow ?? 0) - (dashboard?.todayOutflow ?? 0))}
              tone={dashboard && dashboard.todayInflow - dashboard.todayOutflow < 0 ? "danger" : "default"}
            />
          </SummarySection>

          <SummarySection title="Расчёты с контрагентами">
            <StatCard
              icon={TrendingUp}
              label="Дебиторская задолженность"
              value={formatMoney(dashboard?.accountsReceivable ?? 0)}
              tone={dashboard && dashboard.accountsReceivable > 0 ? "warning" : "default"}
            />
            <StatCard
              icon={TrendingDown}
              label="Кредиторская задолженность"
              value={formatMoney(dashboard?.accountsPayable ?? 0)}
              tone={dashboard && dashboard.accountsPayable > 0 ? "warning" : "default"}
            />
          </SummarySection>

          <SummarySection title={`Финансовый результат — ${PERIOD_LABELS[period].toLowerCase()}`} last>
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
          </SummarySection>

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Последние операции</h2>
            </div>
            <MovementsTable movements={movements.slice(0, 8)} />
          </div>
        </>
      )}

      {tab === "bank" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Счета</h2>
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

          <div className="mb-4 flex justify-end">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={showArchivedAccounts}
                onChange={(e) => setShowArchivedAccounts(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-accent"
              />
              Показать архивные
            </label>
          </div>

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Счёт</th>
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">Точка</th>
                  <th className="px-5 py-3 text-right font-medium">Сальдо</th>
                  <th className="px-5 py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...bankAccounts, ...cashAccounts].map((a) => (
                  <tr key={a.id} className={!a.isActive ? "opacity-50" : undefined}>
                    <td className="px-5 py-3 font-medium text-foreground">
                      {a.name}
                      {a.isDefault && (
                        <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                          Основной
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{CASH_ACCOUNT_TYPE_LABELS_RU[a.type]}</td>
                    <td className="px-5 py-3 text-muted">{a.locationName ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(a.currentBalance)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {canManageAccounts && a.type === CashAccountType.BANK && !a.isDefault && a.isActive && (
                          <button
                            onClick={() => handleSetDefaultAccount(a)}
                            className="text-xs font-medium text-accent hover:opacity-80"
                          >
                            Сделать основным
                          </button>
                        )}
                        {canManageAccounts && (
                          <RowActions
                            isActive={a.isActive}
                            onArchive={() => handleArchiveAccount(a)}
                            onRestore={() => handleRestoreAccount(a)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                      Счетов пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "cashflow" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Движение денежных средств</h2>
              <p className="mt-0.5 text-xs text-muted">Полный, неизменяемый журнал всех денежных операций</p>
            </div>
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

      {tab === "receivables" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Дебиторская задолженность</h2>
              <p className="mt-0.5 text-xs text-muted">Задолженность покупателей перед нами</p>
            </div>
            <span className="text-base font-semibold text-foreground">{formatMoney(totalReceivable)}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Контрагент</th>
                <th className="px-5 py-3 text-right font-medium">Кредитный лимит</th>
                <th className="px-5 py-3 text-right font-medium">Использовано</th>
                <th className="px-5 py-3 text-right font-medium">Задолженность</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {debtorCustomers.map((c) => {
                const utilization = c.creditLimit ? (c.outstandingBalance / c.creditLimit) * 100 : null;
                return (
                  <tr key={c.id}>
                    <td className="px-5 py-3 text-foreground">{c.name}</td>
                    <td className="px-5 py-3 text-right text-muted">{c.creditLimit !== null ? formatMoney(c.creditLimit) : "—"}</td>
                    <td className={clsx("px-5 py-3 text-right", utilization !== null && utilization >= 100 ? "font-medium text-red-600" : "text-muted")}>
                      {utilization !== null ? `${utilization.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(c.outstandingBalance)}</td>
                  </tr>
                );
              })}
              {debtorCustomers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted">
                    Дебиторской задолженности нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payables" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Кредиторская задолженность</h2>
              <p className="mt-0.5 text-xs text-muted">Наша задолженность перед поставщиками и по расходам</p>
            </div>
            <span className="text-base font-semibold text-foreground">{formatMoney(totalPayable)}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Документ</th>
                <th className="px-5 py-3 font-medium">Контрагент / статья</th>
                <th className="px-5 py-3 text-right font-medium">Дней</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 text-right font-medium">Остаток</th>
                <th className="px-5 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payableRows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="px-5 py-3 text-foreground">{r.label}</td>
                  <td className="px-5 py-3 text-muted">{r.counterparty}</td>
                  <td className="px-5 py-3 text-right text-muted">{daysSince(r.date)}</td>
                  <td className="px-5 py-3">
                    <PaymentStatusBadge status={r.paymentStatus} />
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(r.balanceDue)}</td>
                  <td className="px-5 py-3 text-right">
                    {canPaySuppliers && (
                      <button
                        onClick={() => setPayingDebt(r)}
                        className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90"
                      >
                        Погасить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {payableRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                    Кредиторской задолженности нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "expenses" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Статья</th>
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
                    {e.status === ExpenseStatus.CONFIRMED ? (
                      <PaymentStatusBadge status={e.paymentStatus} />
                    ) : (
                      <span
                        className={clsx(
                          "rounded-full px-2.5 py-1 text-xs font-medium",
                          e.status === ExpenseStatus.DRAFT ? "bg-surface-muted text-muted" : "bg-red-50 text-red-700",
                        )}
                      >
                        {e.status === ExpenseStatus.DRAFT ? "Черновик" : "Отменён"}
                      </span>
                    )}
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
                            paymentStatus: e.paymentStatus,
                          })
                        }
                        className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90"
                      >
                        Погасить
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
      )}

      {tab === "categories" && (
        <>
          <div className="mb-4 flex justify-end">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={showArchivedCategories}
                onChange={(e) => setShowArchivedCategories(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-accent"
              />
              Показать архивные
            </label>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CategoryList
              title="Статьи доходов"
              categories={categories.filter((c) => c.kind === FinanceCategoryKind.INCOME)}
              canManage={canManageCategories}
              onAdd={() => setCategoryModal("income")}
              onEdit={(c) => setCategoryModal(c)}
              onArchive={handleArchiveCategory}
              onRestore={handleRestoreCategory}
            />
            <CategoryList
              title="Статьи расходов"
              categories={categories.filter((c) => c.kind === FinanceCategoryKind.EXPENSE)}
              canManage={canManageCategories}
              showCostBehavior
              onAdd={() => setCategoryModal("expense")}
              onEdit={(c) => setCategoryModal(c)}
              onArchive={handleArchiveCategory}
              onRestore={handleRestoreCategory}
              onSetCostBehavior={handleSetCostBehavior}
            />
          </div>
          <p className="mt-4 text-xs text-muted">
            Тип затрат по статье расходов: <b className="text-foreground">постоянные</b> — не зависят
            от объёма продаж (аренда, оклады), <b className="text-foreground">переменные</b> — растут
            вместе с объёмом продаж (логистика). Классификация используется при расчёте маржинальной
            прибыли и точки безубыточности — см. вкладку «Точка безубыточности».
          </p>
        </>
      )}

      {tab === "pnl" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Отчёт о прибылях и убытках (P&amp;L)</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                    {PERIOD_LABELS[p]}
                  </TabButton>
                ))}
              </div>
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
            <StatCard icon={TrendingDown} label="Операционные расходы" value={formatMoney(pnl?.expensesTotal ?? 0)} />
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
              <h2 className="text-sm font-semibold text-foreground">Финансовый результат по товарам</h2>
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

      {tab === "breakeven" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Точка безубыточности</h2>
              <p className="mt-1 text-sm text-muted">
                {breakEvenMode === "fact"
                  ? "Факт: расчёт по фактическим затратам за выбранный период"
                  : "План: расчёт по плановым постоянным затратам, в расчёте на месяц"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
                <TabButton active={breakEvenMode === "fact"} onClick={() => setBreakEvenMode("fact")}>
                  Факт
                </TabButton>
                <TabButton active={breakEvenMode === "plan"} onClick={() => setBreakEvenMode("plan")}>
                  План
                </TabButton>
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                    {PERIOD_LABELS[p]}
                  </TabButton>
                ))}
              </div>
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
            </div>
          </div>

          {breakEvenMode === "fact" ? (
            <>
              {breakEven && breakEven.status !== BreakEvenStatus.OK && (
                <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {breakEvenStatusMessage(breakEven.status)}
                </div>
              )}

              <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                <StatCard
                  icon={TrendingUp}
                  label="Выручка"
                  value={formatMoney(breakEven?.revenue ?? 0)}
                  hint="Сумма продаж за выбранный период"
                />
                <StatCard
                  icon={TrendingDown}
                  label="Переменные затраты"
                  value={formatMoney((breakEven?.cogs ?? 0) + (breakEven?.variableExpensesTotal ?? 0))}
                  hint="Себестоимость проданного плюс расходы, растущие вместе с объёмом продаж"
                />
                <StatCard
                  icon={TrendingDown}
                  label="Постоянные затраты"
                  value={formatMoney(breakEven?.fixedExpensesTotal ?? 0)}
                  hint="Затраты, не зависящие от объёма продаж, за выбранный период"
                />
                <StatCard
                  icon={Wallet}
                  label="Маржинальная прибыль"
                  value={formatMoney(breakEven?.contributionMargin ?? 0)}
                  hint="Выручка минус переменные затраты — то, что остаётся на покрытие постоянных затрат"
                  tone={breakEven && breakEven.contributionMargin < 0 ? "danger" : "default"}
                />
                <StatCard
                  icon={Wallet}
                  label="Маржинальность"
                  value={breakEven?.contributionMarginPercent != null ? `${breakEven.contributionMarginPercent.toFixed(1)}%` : "—"}
                  hint="Доля маржинальной прибыли в выручке"
                />
                <StatCard
                  icon={Target}
                  label="Точка безубыточности"
                  value={breakEven?.status === BreakEvenStatus.OK && breakEven.breakEvenRevenue != null ? formatMoney(breakEven.breakEvenRevenue) : "—"}
                  hint="Минимальная выручка за период для покрытия постоянных и переменных затрат"
                />
              </div>

              {breakEven && breakEven.unclassifiedExpensesTotal > 0 && (
                <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Не классифицировано затрат на {formatMoney(breakEven.unclassifiedExpensesTotal)} за
                  период — они не учтены ни как постоянные, ни как переменные. Укажите тип затрат по
                  статье на вкладке «Статьи ДДС» для корректного расчёта.
                </div>
              )}

              <div className="rounded-2xl border border-border bg-surface shadow-card">
                <div className="border-b border-border px-5 py-4">
                  <h2 className="text-sm font-semibold text-foreground">
                    Постоянные затраты по статьям (факт)
                  </h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-medium">Статья</th>
                      <th className="px-5 py-3 text-right font-medium">Сумма за период</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {breakEven?.fixedCostLines.map((line) => (
                      <tr key={line.categoryId}>
                        <td className="px-5 py-3 font-medium text-foreground">{line.categoryName}</td>
                        <td className="px-5 py-3 text-right text-foreground">{formatMoney(line.amount)}</td>
                      </tr>
                    ))}
                    {(!breakEven || breakEven.fixedCostLines.length === 0) && (
                      <tr>
                        <td colSpan={2} className="px-5 py-8 text-center text-sm text-muted">
                          Нет расходов, отмеченных как постоянные, за этот период
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted">
                Плановые суммы указываются <b className="text-foreground">в расчёте на месяц</b> и не
                формируют проводок — они не влияют на ДДС, P&amp;L и фактическую точку безубыточности.
                Маржинальность берётся фактическая, за выбранный период.
              </div>

              {plannedBreakEven && plannedBreakEven.status !== BreakEvenStatus.OK && (
                <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {plannedBreakEvenStatusMessage(plannedBreakEven.status)}
                </div>
              )}

              <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                <StatCard
                  icon={Wallet}
                  label="Плановый ФЗП"
                  value={`${formatMoney(plannedBreakEven?.payroll.total ?? 0)}/мес.`}
                  hint="Фонд заработной платы — сумма месячных окладов сотрудников"
                />
                <StatCard
                  icon={TrendingDown}
                  label="Прочие постоянные затраты (план)"
                  value={`${formatMoney(plannedBreakEven?.plannedOtherFixedTotal ?? 0)}/мес.`}
                  hint="Аренда, коммунальные услуги и другие плановые постоянные затраты"
                />
                <StatCard
                  icon={TrendingDown}
                  label="Постоянные затраты, всего (план)"
                  value={`${formatMoney(plannedBreakEven?.plannedFixedTotal ?? 0)}/мес.`}
                  hint="Плановый ФЗП плюс прочие плановые постоянные затраты"
                />
                <StatCard
                  icon={TrendingUp}
                  label="Выручка (факт)"
                  value={formatMoney(plannedBreakEven?.revenue ?? 0)}
                  hint="Фактические продажи за выбранный период — база для расчёта маржинальности"
                />
                <StatCard
                  icon={Wallet}
                  label="Маржинальность (факт)"
                  value={
                    plannedBreakEven?.contributionMarginPercent != null
                      ? `${plannedBreakEven.contributionMarginPercent.toFixed(1)}%`
                      : "—"
                  }
                  hint="Доля маржинальной прибыли в выручке по фактическим данным периода"
                  tone={plannedBreakEven && plannedBreakEven.contributionMargin < 0 ? "danger" : "default"}
                />
                <StatCard
                  icon={Target}
                  label="Точка безубыточности"
                  value={
                    plannedBreakEven?.status === BreakEvenStatus.OK && plannedBreakEven.breakEvenRevenue != null
                      ? `${formatMoney(plannedBreakEven.breakEvenRevenue)}/мес.`
                      : "—"
                  }
                  hint="Минимальная месячная выручка для покрытия постоянных и переменных затрат"
                />
              </div>

              {plannedBreakEven && plannedBreakEven.payroll.exclusions.length > 0 && (
                <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    Не учтено в плановом ФЗП
                  </div>
                  <ul className="mt-2 space-y-1 pl-6">
                    {plannedBreakEven.payroll.exclusions.map((ex) => (
                      <li key={`${ex.reason}-${ex.paymentType ?? "none"}`} className="list-disc">
                        {ex.employeeCount}{" "}
                        {ex.employeeCount === 1 ? "сотрудник" : "сотрудников"} —{" "}
                        {ex.reason === PayrollExclusionReason.NON_MONTHLY_RATE && ex.paymentType
                          ? COMPENSATION_TYPE_LABELS_RU[ex.paymentType].toLowerCase()
                          : PAYROLL_EXCLUSION_REASON_LABELS_RU[ex.reason].toLowerCase()}{" "}
                        <span className="text-amber-700">({ex.employeeNames.join(", ")})</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 pl-6 text-xs">
                    Плановый ФЗП рассчитан только по месячным окладам, поэтому фактические затраты
                    на персонал выше указанной суммы.
                  </p>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-surface shadow-card">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <h2 className="text-sm font-semibold text-foreground">
                    Прочие постоянные затраты по статьям (план)
                  </h2>
                  {canManagePlannedCosts && (
                    <button
                      onClick={() => setPlannedCostModalOpen(true)}
                      className="flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Добавить
                    </button>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-medium">Статья</th>
                      <th className="px-5 py-3 font-medium">Точка</th>
                      <th className="px-5 py-3 text-right font-medium">Сумма в месяц</th>
                      {canManagePlannedCosts && <th className="px-5 py-3 font-medium">Действия</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {plannedFixedCosts.map((row) => (
                      <tr key={row.id}>
                        <td className="px-5 py-3 font-medium text-foreground">{row.categoryName}</td>
                        <td className="px-5 py-3 text-muted">{row.locationName ?? "Вся сеть"}</td>
                        <td className="px-5 py-3 text-right text-foreground">{formatMoney(row.amount)}</td>
                        {canManagePlannedCosts && (
                          <td className="px-5 py-3">
                            <button
                              onClick={() => handleClosePlannedFixedCost(row)}
                              title="Убрать из плана"
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                            >
                              <Archive className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {plannedFixedCosts.length === 0 && (
                      <tr>
                        <td
                          colSpan={canManagePlannedCosts ? 4 : 3}
                          className="px-5 py-8 text-center text-sm text-muted"
                        >
                          Плановых постоянных расходов пока нет
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 rounded-2xl border border-border bg-surface shadow-card">
                <div className="border-b border-border px-5 py-4">
                  <h2 className="text-sm font-semibold text-foreground">
                    Плановый ФЗП (фонд заработной платы)
                  </h2>
                </div>
                <div className="px-5 py-4 text-sm text-muted">
                  В расчёт включено {plannedBreakEven?.payroll.includedEmployeeCount ?? 0} сотрудников
                  с месячным окладом на сумму{" "}
                  <b className="text-foreground">{formatMoney(plannedBreakEven?.payroll.total ?? 0)}</b>{" "}
                  в месяц. Оклады задаются в разделе{" "}
                  <Link href="/hr" className="text-accent hover:underline">
                    Персонал
                  </Link>{" "}
                  — кнопка «Ставка» у сотрудника.
                </div>
              </div>
            </>
          )}
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
          category={typeof categoryModal === "object" ? categoryModal : undefined}
          defaultKind={categoryModal === "income" ? FinanceCategoryKind.INCOME : FinanceCategoryKind.EXPENSE}
          onClose={() => setCategoryModal(null)}
          onSaved={() => {
            setCategoryModal(null);
            loadCategories();
          }}
        />
      )}

      {plannedCostModalOpen && (
        <PlannedFixedCostModal
          categories={categories}
          locations={locations}
          onClose={() => setPlannedCostModalOpen(false)}
          onSaved={() => {
            setPlannedCostModalOpen(false);
            loadPlannedFixedCosts();
            loadPlannedBreakEven();
          }}
        />
      )}

      {payingDebt && (
        <RecordDebtPaymentModal
          title={`Погашение: ${payingDebt.label}`}
          balanceDue={payingDebt.balanceDue}
          accounts={activeAccounts}
          onClose={() => setPayingDebt(null)}
          onSubmit={(amount, accountId) => submitDebtPayment(payingDebt, amount, accountId)}
        />
      )}
    </div>
  );
}

function CategoryList({
  title,
  categories,
  canManage,
  showCostBehavior = false,
  onAdd,
  onEdit,
  onArchive,
  onRestore,
  onSetCostBehavior,
}: {
  title: string;
  categories: FinanceCategoryDto[];
  canManage: boolean;
  showCostBehavior?: boolean;
  onAdd: () => void;
  onEdit: (c: FinanceCategoryDto) => void;
  onArchive: (c: FinanceCategoryDto) => void;
  onRestore: (c: FinanceCategoryDto) => void;
  onSetCostBehavior?: (c: FinanceCategoryDto, costBehavior: CostBehavior) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {canManage && (
          <button onClick={onAdd} className="flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Добавить
          </button>
        )}
      </div>
      <ul className="divide-y divide-border">
        {categories.map((c) => (
          <li key={c.id} className={clsx("flex items-center justify-between gap-3 px-5 py-3 text-sm", !c.isActive && "opacity-50")}>
            <button onClick={() => canManage && onEdit(c)} className={clsx("text-foreground", canManage && "hover:underline")}>
              {c.name}
            </button>
            <div className="flex items-center gap-2">
              {showCostBehavior &&
                (canManage && onSetCostBehavior ? (
                  <select
                    value={c.costBehavior}
                    onChange={(e) => onSetCostBehavior(c, e.target.value as CostBehavior)}
                    className={clsx(
                      "rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent",
                      c.costBehavior === CostBehavior.UNCLASSIFIED ? "text-amber-600" : "text-muted",
                    )}
                  >
                    {Object.values(CostBehavior).map((b) => (
                      <option key={b} value={b}>
                        {COST_BEHAVIOR_LABELS_RU[b]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      c.costBehavior === CostBehavior.UNCLASSIFIED
                        ? "bg-amber-50 text-amber-700"
                        : "bg-surface-muted text-muted",
                    )}
                  >
                    {COST_BEHAVIOR_LABELS_RU[c.costBehavior]}
                  </span>
                ))}
              {canManage &&
                (c.isActive ? (
                  <button
                    onClick={() => onArchive(c)}
                    title="Архивировать"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-amber-600"
                  >
                    <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                ) : (
                  <button
                    onClick={() => onRestore(c)}
                    title="Восстановить"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-green-600"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                ))}
            </div>
          </li>
        ))}
        {categories.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Статей пока нет</li>}
      </ul>
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
          <th className="px-5 py-3 font-medium">Тип операции</th>
          <th className="px-5 py-3 font-medium">Контрагент / статья</th>
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

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const styles: Record<PaymentStatus, string> = {
    [PaymentStatus.PAID]: "bg-emerald-50 text-emerald-700",
    [PaymentStatus.PARTIALLY_PAID]: "bg-amber-50 text-amber-700",
    [PaymentStatus.UNPAID]: "bg-red-50 text-red-700",
  };
  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", styles[status])}>
      {PAYMENT_STATUS_LABELS_RU[status]}
    </span>
  );
}

function SummarySection({
  title,
  children,
  last = false,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? "mb-4" : "mb-6"}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{children}</div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  // Plain-language explanation of the term in `label`. The professional
  // term always stays as the label — the hint explains it, it never
  // replaces it (see the terminology rule in CLAUDE.md).
  hint?: string;
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
      {hint && <p className="mt-1 text-xs leading-snug text-muted/80">{hint}</p>}
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
