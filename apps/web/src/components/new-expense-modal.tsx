"use client";

import { useState } from "react";
import type { LocationDto } from "@bakery-os/shared";
import { EXPENSE_CATEGORY_LABELS_RU, ExpenseCategory } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function NewExpenseModal({
  locations,
  onClose,
  onCreated,
}: {
  locations: LocationDto[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>(ExpenseCategory.OTHER);
  const [amount, setAmount] = useState("");
  const [locationId, setLocationId] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.finance.createExpense({
        category,
        amount: Number(amount),
        locationId: locationId || undefined,
        description: description || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить расход");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Новый расход" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Категория</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(ExpenseCategory).map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABELS_RU[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Сумма, ₸</label>
            <input
              type="number"
              min="0"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Точка <span className="text-muted">(необязательно — иначе расход общесетевой)</span>
          </label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Вся сеть</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Описание <span className="text-muted">(необязательно)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : "Добавить расход"}
        </button>
      </form>
    </Modal>
  );
}
