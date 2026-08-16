"use client";

import { useEffect, useState } from "react";
import type { FinanceCategoryDto, LocationDto } from "@bakery-os/shared";
import { CostBehavior, FinanceCategoryKind } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

// Adds a PLANNED monthly fixed cost. Deliberately never touches Expense or
// CashMovement — the modal says so out loud, because "I entered the rent"
// meaning two different things is exactly the confusion this split exists
// to prevent.
export function PlannedFixedCostModal({
  categories,
  locations,
  onClose,
  onSaved,
}: {
  categories: FinanceCategoryDto[];
  locations: LocationDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const expenseCategories = categories.filter((c) => c.kind === FinanceCategoryKind.EXPENSE && c.isActive);

  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Categories can still be loading when this modal opens, so the first
  // render may have nothing to default to — backfill once they arrive,
  // without clobbering a choice the user already made.
  useEffect(() => {
    if (!categoryId && expenseCategories.length > 0) {
      setCategoryId(expenseCategories[0].id);
    }
  }, [expenseCategories, categoryId]);

  const selectedCategory = expenseCategories.find((c) => c.id === categoryId) ?? null;

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
      await api.finance.plannedFixedCosts.create({
        categoryId,
        locationId: locationId || undefined,
        amount: parsed,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить плановый расход");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Плановые постоянные затраты" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Статья расхода</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {expenseCategories.length === 0 && <option value="">Сначала добавьте статью расходов</option>}
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {selectedCategory && selectedCategory.costBehavior !== CostBehavior.FIXED && (
            <p className="mt-1.5 text-xs text-amber-600">
              Эта статья не классифицирована как «Постоянные». Плановая сумма сохранится, но в
              фактической точке безубыточности затраты по ней постоянными учитываться не будут.
            </p>
          )}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Сумма, ₸/мес.
            </label>
            <input
              type="number"
              required
              min={0}
              step="0.01"
              placeholder="₸ в месяц"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Точка</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Вся сеть</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting || expenseCategories.length === 0}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : "Сохранить план"}
        </button>
        <p className="mt-2 text-xs text-muted">
          Плановая величина для управленческого учёта — не формирует расход и не отражается в
          денежном потоке. Фактическую оплату необходимо провести через Финансы → Расходы.
        </p>
      </form>
    </Modal>
  );
}
