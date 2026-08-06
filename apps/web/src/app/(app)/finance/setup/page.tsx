"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Package,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";
import type {
  CashAccountDto,
  FinanceCategoryDto,
  FinanceSetupStatusDto,
  InventoryValuationDto,
  InvoiceDto,
  LocationDto,
} from "@bakery-os/shared";
import { CASH_ACCOUNT_TYPE_LABELS_RU, FINANCE_SETUP_ROLES, FinanceCategoryKind, InvoiceStatus } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney, formatQuantity } from "@/lib/format";
import { NewCashAccountModal } from "@/components/new-cash-account-modal";

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS: Record<Step, string> = {
  1: "Счета",
  2: "Запасы",
  3: "Дебиторская задолженность",
  4: "Кредиторская задолженность",
  5: "Итоговая сводка",
};

export default function FinanceSetupPage() {
  const { user } = useAuth();
  const canRun = user ? FINANCE_SETUP_ROLES.includes(user.role) : false;

  const [status, setStatus] = useState<FinanceSetupStatusDto | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [inventory, setInventory] = useState<InventoryValuationDto | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string; outstandingBalance: number }[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [reconcileDrafts, setReconcileDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadStatus = useCallback(() => {
    api.finance.setup.status().then(setStatus).catch(() => setError("Не удалось загрузить статус"));
  }, []);

  const loadAccounts = useCallback(() => {
    api.finance.accounts.list().then(setAccounts).catch(() => {});
  }, []);

  const loadInventory = useCallback(() => {
    api.finance.inventoryValuation().then(setInventory).catch(() => {});
  }, []);

  const loadDebts = useCallback(() => {
    api.customers.list().then((list) => setCustomers(list.filter((c) => c.outstandingBalance > 0))).catch(() => {});
    api.invoices.list().then((list) => setInvoices(list.filter((i) => i.status === InvoiceStatus.CONFIRMED))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canRun) return;
    loadStatus();
    loadAccounts();
    loadInventory();
    loadDebts();
    api.finance.categories.list(FinanceCategoryKind.EXPENSE).then(setCategories).catch(() => {});
    api.locations.list().then(setLocations).catch(() => {});
  }, [canRun, loadStatus, loadAccounts, loadInventory, loadDebts]);

  if (!canRun) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} />
        <h1 className="text-lg font-semibold text-foreground">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted">Запуск финансового учёта доступен владельцу и администратору.</p>
      </div>
    );
  }

  if (!status) {
    return <p className="py-24 text-center text-sm text-muted">Загрузка…</p>;
  }

  // Already run once — no wizard, just the permanent record. There is no
  // "redo" path; a mistake found later is corrected through ordinary ERP
  // mechanisms (stock adjustment, cash correction, ordinary payments), not
  // by revisiting this screen.
  if (status.initialized) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Финансовый учёт запущен</h1>
            <p className="mt-0.5 text-sm text-muted">
              {status.initializedAt && new Date(status.initializedAt).toLocaleDateString("ru-RU")} ·{" "}
              {status.initializedByName}
            </p>
          </div>
        </div>
        <BalanceEquation status={status} />
      </div>
    );
  }

  async function goNext() {
    setError(null);
    if (step === 4) {
      // Persist any unsaved reconciliation edits before moving to the
      // summary so it reflects the latest state.
      await saveReconciliation();
    }
    setStep((s) => (s < 5 ? ((s + 1) as Step) : s));
    if (step === 4) loadStatus();
  }

  function goBack() {
    setError(null);
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  async function saveReconciliation() {
    const items = Object.entries(reconcileDrafts)
      .filter(([, v]) => v !== "")
      .map(([invoiceId, v]) => ({ invoiceId, amountPaid: Number(v) }));
    if (items.length === 0) return;
    try {
      await api.finance.setup.reconcileInvoices({ items });
      setReconcileDrafts({});
      loadDebts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить сверку");
      throw err;
    }
  }

  function markAllInvoicesPaid() {
    const drafts: Record<string, string> = {};
    for (const inv of invoices) {
      if (inv.balanceDue > 0) drafts[inv.id] = String(inv.totalCost);
    }
    setReconcileDrafts(drafts);
  }

  async function handleComplete() {
    if (
      !confirm(
        "Финансовый учёт можно запустить только один раз. После подтверждения остатки запасов, дебиторская и кредиторская задолженность на эту дату будут зафиксированы навсегда. Продолжить?",
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await saveReconciliation();
      const result = await api.finance.setup.complete();
      setStatus(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось завершить запуск учёта");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Запуск финансового учёта</h1>
        <p className="mt-1 text-sm text-muted">
          Разовая фиксация финансового состояния компании на сегодня — склад, продажи и производство уже
          ведутся, теперь то же самое для денег.
        </p>
      </div>

      <div className="mb-8 flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1">
        {([1, 2, 3, 4, 5] as Step[]).map((s) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            className={clsx(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition",
              step === s ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {s}. {STEP_LABELS[s]}
          </button>
        ))}
      </div>

      {error && <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {step === 1 && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted">
              Создайте банковские счета и кассы с реальными остатками на сегодняшний день.
            </p>
            <button
              onClick={() => setAccountModalOpen(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый счёт
            </button>
          </div>
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Счёт</th>
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">Точка</th>
                  <th className="px-5 py-3 text-right font-medium">Сальдо</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-3 font-medium text-foreground">{a.name}</td>
                    <td className="px-5 py-3 text-muted">{CASH_ACCOUNT_TYPE_LABELS_RU[a.type]}</td>
                    <td className="px-5 py-3 text-muted">{a.locationName ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(a.currentBalance)}</td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted">
                      Счетов пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="mb-4 text-sm text-muted">
            Складские остатки уже есть в системе — используются как есть, оцениваются по себестоимости
            (для сырья — цена сырья, для готовой продукции — себестоимость по рецепту или средней цене
            закупки). Продажная цена нигде не участвует.
          </p>
          {inventory && inventory.unknownValueLineItems > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {inventory.unknownValueLineItems}{" "}
              {inventory.unknownValueLineItems === 1 ? "позиция" : "позиций"} без данных о себестоимости —
              не учтены в стоимости запасов.
            </div>
          )}
          <div className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-accent">
                <Package className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{formatMoney(inventory?.totalValue ?? 0)}</p>
                <p className="text-sm text-muted">Стоимость запасов</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Товар</th>
                  <th className="px-5 py-3 font-medium">Точка</th>
                  <th className="px-5 py-3 text-right font-medium">Кол-во</th>
                  <th className="px-5 py-3 text-right font-medium">Себестоимость</th>
                  <th className="px-5 py-3 text-right font-medium">Стоимость</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inventory?.byProduct.map((p, i) => (
                  <tr key={`${p.productId}-${p.locationId}-${i}`}>
                    <td className="px-5 py-3 text-foreground">
                      {p.productName}
                      {!p.hasCostData && <span className="ml-1.5 text-xs text-amber-600">без себестоимости</span>}
                    </td>
                    <td className="px-5 py-3 text-muted">{p.locationName}</td>
                    <td className="px-5 py-3 text-right text-muted">{formatQuantity(p.quantity)}</td>
                    <td className="px-5 py-3 text-right text-muted">{p.unitCost !== null ? formatMoney(p.unitCost) : "—"}</td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(p.value)}</td>
                  </tr>
                ))}
                {(!inventory || inventory.byProduct.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                      На складе пусто
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <p className="mb-4 text-sm text-muted">
            Уже посчитано из проведённых продаж — ничего вводить не нужно.
          </p>
          <div className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-accent">
                <Users className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">
                  {formatMoney(customers.reduce((sum, c) => sum + c.outstandingBalance, 0))}
                </p>
                <p className="text-sm text-muted">Дебиторская задолженность</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Контрагент</th>
                  <th className="px-5 py-3 text-right font-medium">Задолженность</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-3 text-foreground">{c.name}</td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">{formatMoney(c.outstandingBalance)}</td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-5 py-8 text-center text-sm text-muted">
                      Дебиторской задолженности нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 4 && (
        <PayablesStep
          invoices={invoices}
          categories={categories}
          locations={locations}
          reconcileDrafts={reconcileDrafts}
          onDraftChange={(id, v) => setReconcileDrafts((prev) => ({ ...prev, [id]: v }))}
          onMarkAllPaid={markAllInvoicesPaid}
          onManualEntryAdded={loadDebts}
          setError={setError}
        />
      )}

      {step === 5 && <BalanceEquation status={status} preview />}

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={goBack}
          disabled={step === 1}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Назад
        </button>
        {step < 5 ? (
          <button
            onClick={goNext}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            Далее
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            onClick={handleComplete}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
            {isSubmitting ? "Завершение…" : "Подтвердить и завершить"}
          </button>
        )}
      </div>

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
    </div>
  );
}

function PayablesStep({
  invoices,
  categories,
  locations,
  reconcileDrafts,
  onDraftChange,
  onMarkAllPaid,
  onManualEntryAdded,
  setError,
}: {
  invoices: InvoiceDto[];
  categories: FinanceCategoryDto[];
  locations: LocationDto[];
  reconcileDrafts: Record<string, string>;
  onDraftChange: (invoiceId: string, value: string) => void;
  onMarkAllPaid: () => void;
  onManualEntryAdded: () => void;
  setError: (msg: string | null) => void;
}) {
  const openingCategory = categories.find((c) => c.name === "Начальные остатки") ?? categories[0];
  const [manualAmount, setManualAmount] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualCategoryId, setManualCategoryId] = useState(openingCategory?.id ?? "");
  const [manualLocationId, setManualLocationId] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!manualCategoryId && openingCategory) setManualCategoryId(openingCategory.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingCategory]);

  async function addManualPayable(e: React.FormEvent) {
    e.preventDefault();
    setIsAdding(true);
    setError(null);
    try {
      const created = await api.finance.createExpense({
        categoryId: manualCategoryId || undefined,
        locationId: manualLocationId || undefined,
        amount: Number(manualAmount),
        description: manualDescription || undefined,
        paidImmediately: false,
      });
      await api.finance.confirmExpense(created.id);
      setManualAmount("");
      setManualDescription("");
      onManualEntryAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить задолженность");
    } finally {
      setIsAdding(false);
    }
  }

  const unpaidInvoices = invoices.filter((i) => i.balanceDue > 0);

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Проведённые накладные поставщиков сейчас считаются полностью неоплаченными. Отметьте те, что на
        самом деле уже оплатили — прошлый платёж не создаёт новую операцию в ДДС, он лишь фиксирует факт,
        который был до начала денежного учёта.
      </p>

      {unpaidInvoices.length > 0 && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={onMarkAllPaid}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
          >
            Отметить все как оплаченные
          </button>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Накладная</th>
              <th className="px-5 py-3 font-medium">Поставщик</th>
              <th className="px-5 py-3 text-right font-medium">Сумма</th>
              <th className="px-5 py-3 text-right font-medium">Оплачено (укажите факт)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {unpaidInvoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-5 py-3 text-foreground">№{inv.number}</td>
                <td className="px-5 py-3 text-muted">{inv.supplierName}</td>
                <td className="px-5 py-3 text-right text-muted">{formatMoney(inv.totalCost)}</td>
                <td className="px-5 py-3 text-right">
                  <input
                    type="number"
                    min="0"
                    max={inv.totalCost}
                    step="any"
                    placeholder="0"
                    value={reconcileDrafts[inv.id] ?? ""}
                    onChange={(e) => onDraftChange(inv.id, e.target.value)}
                    className="w-32 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </td>
              </tr>
            ))}
            {unpaidInvoices.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted">
                  Непроверенных накладных нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">
        Дополнительная задолженность <span className="font-normal text-muted">(если накладной в системе нет)</span>
      </h2>
      <form onSubmit={addManualPayable} className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Сумма, ₸</label>
          <input
            type="number"
            min="0"
            step="any"
            required
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
            className="w-32 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1.5 block text-xs font-medium text-foreground">Кому должны / за что</label>
          <input
            type="text"
            placeholder="Например: ТОО «Мука+»"
            value={manualDescription}
            onChange={(e) => setManualDescription(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Точка</label>
          <select
            value={manualLocationId}
            onChange={(e) => setManualLocationId(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Вся сеть</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={isAdding}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isAdding ? "Добавление…" : "Добавить"}
        </button>
      </form>
    </div>
  );
}

function BalanceEquation({ status, preview = false }: { status: FinanceSetupStatusDto; preview?: boolean }) {
  return (
    <div>
      {preview && (
        <p className="mb-4 text-sm text-muted">
          Проверьте итог перед завершением — после подтверждения запасы, дебиторская и кредиторская
          задолженность на сегодня будут зафиксированы навсегда.
        </p>
      )}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <EquationTile label="Денежные средства" value={status.cashValue} icon={Banknote} />
          <EquationSign symbol="+" />
          <EquationTile label="Запасы" value={status.inventoryValue} icon={Package} />
        </div>
        <div className="my-3 flex justify-center text-2xl font-light text-muted sm:hidden">+</div>
        <div className="my-4 grid grid-cols-1 items-center gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <EquationTile label="Дебиторская задолженность" value={status.receivablesValue} icon={Users} full />
          </div>
        </div>
        <div className="my-4 flex items-center justify-center gap-3 border-y border-border py-4">
          <span className="text-lg font-light text-muted">=</span>
          <span className="text-sm font-semibold uppercase tracking-wide text-muted">Активы</span>
          <span className="ml-auto text-xl font-semibold text-foreground">{formatMoney(status.totalAssets)}</span>
        </div>

        <div className="my-4 flex items-center justify-center gap-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted">Кредиторская задолженность</span>
          <span className="ml-auto text-lg font-medium text-foreground">{formatMoney(status.payablesValue)}</span>
        </div>
        <div className="my-4 flex items-center justify-center gap-3 border-y border-border py-4">
          <span className="text-lg font-light text-muted">=</span>
          <span className="text-sm font-semibold uppercase tracking-wide text-muted">Обязательства</span>
          <span className="ml-auto text-xl font-semibold text-foreground">{formatMoney(status.totalLiabilities)}</span>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <span className="text-sm text-muted">Активы − Обязательства</span>
          <span className="text-lg font-light text-muted">=</span>
          <span className="ml-auto text-sm font-semibold uppercase tracking-wide text-foreground">Капитал</span>
          <span
            className={clsx(
              "text-2xl font-semibold",
              status.equity < 0 ? "text-red-600" : "text-emerald-600",
            )}
          >
            {formatMoney(status.equity)}
          </span>
        </div>
      </div>
    </div>
  );
}

function EquationTile({
  label,
  value,
  icon: Icon,
  full = false,
}: {
  label: string;
  value: number;
  icon: typeof Banknote;
  full?: boolean;
}) {
  return (
    <div className={clsx("rounded-xl bg-surface-muted p-4", full && "flex items-center justify-between")}>
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-accent">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <p className="text-lg font-semibold text-foreground">{formatMoney(value)}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function EquationSign({ symbol }: { symbol: string }) {
  return <div className="hidden items-center justify-center text-2xl font-light text-muted sm:flex">{symbol}</div>;
}
