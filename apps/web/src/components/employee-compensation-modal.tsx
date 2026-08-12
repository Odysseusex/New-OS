"use client";

import { useEffect, useState } from "react";
import type { EmployeeCompensationDto, EmployeeDto } from "@bakery-os/shared";
import { COMPENSATION_TYPE_LABELS_RU, CompensationType } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Modal } from "@/components/modal";

// Plain management/planning figure — never a payroll calculation and never
// auto-connected to real money movement (see the schema comment on
// EmployeeCompensation). Real salary expense still goes through Finance →
// Расходы with the "Зарплата" category, exactly as before.
export function EmployeeCompensationModal({
  employee,
  canManage,
  onClose,
}: {
  employee: EmployeeDto;
  canManage: boolean;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<EmployeeCompensationDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState<CompensationType>(CompensationType.MONTHLY);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function load() {
    setIsLoading(true);
    api.hr.employees
      .compensations(employee.id)
      .then(setHistory)
      .catch(() => setError("Не удалось загрузить историю ставок"))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  const currentRate = history.find((c) => c.effectiveTo === null) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Укажите корректную сумму");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.hr.employees.addCompensation(employee.id, { amount: parsed, paymentType });
      setAmount("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить ставку");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Ставка — ${employee.fullName}`} onClose={onClose}>
      <div className="mb-5 rounded-xl bg-surface-muted p-4">
        <p className="text-xs uppercase tracking-wide text-muted">Текущая ставка</p>
        {currentRate ? (
          <p className="mt-1 text-lg font-semibold text-foreground">
            {formatMoney(currentRate.amount)}{" "}
            <span className="text-sm font-normal text-muted">
              {COMPENSATION_TYPE_LABELS_RU[currentRate.paymentType]}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">Ставка ещё не задана</p>
        )}
      </div>

      {canManage && (
        <form onSubmit={handleSubmit} className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Новая ставка</label>
          <div className="mb-3 grid grid-cols-[1fr_auto] gap-3">
            <input
              type="number"
              required
              min={0}
              step="0.01"
              placeholder="Сумма, ₸"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as CompensationType)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(CompensationType).map((t) => (
                <option key={t} value={t}>
                  {COMPENSATION_TYPE_LABELS_RU[t]}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? "Сохранение…" : "Установить новую ставку"}
          </button>
          <p className="mt-2 text-xs text-muted">
            Это плановая ставка для управленческой отчётности — она не создаёт расход
            автоматически. Фактическую выплату по-прежнему нужно провести через Финансы → Расходы
            → категория «Зарплата».
          </p>
        </form>
      )}

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted">История</p>
        {isLoading ? (
          <p className="text-sm text-muted">Загрузка…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">Записей пока нет</p>
        ) : (
          <ul className="space-y-2">
            {history.map((c) => (
              <li key={c.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {formatMoney(c.amount)}{" "}
                    <span className="font-normal text-muted">{COMPENSATION_TYPE_LABELS_RU[c.paymentType]}</span>
                  </span>
                  {c.effectiveTo === null && (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      Действует
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">
                  С {formatDateTime(c.effectiveFrom)}
                  {c.effectiveTo ? ` до ${formatDateTime(c.effectiveTo)}` : ""} · установил {c.createdByName}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
