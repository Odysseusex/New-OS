"use client";

import { useEffect, useState } from "react";
import type { CashAccountDto, FinanceCategoryDto, LocationDto } from "@bakery-os/shared";
import { FinanceCategoryKind } from "@bakery-os/shared";
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
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [locationId, setLocationId] = useState("");
  const [description, setDescription] = useState("");
  // Checked by default — fast path: log and pay in one step, same as
  // before Expense had a lifecycle at all. Unchecked, it's saved as a
  // draft with nothing paid, to confirm and pay later.
  const [paidImmediately, setPaidImmediately] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.finance.categories.list(FinanceCategoryKind.EXPENSE).then((list) => {
      setCategories(list);
      setCategoryId((prev) => prev || list[0]?.id || "");
    });
    api.finance.accounts.list().then((list) => {
      setAccounts(list);
      setAccountId((prev) => prev || list[0]?.id || "");
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.finance.createExpense({
        categoryId: categoryId || undefined,
        amount: Number(amount),
        locationId: locationId || undefined,
        description: description || undefined,
        paidImmediately,
        accountId: paidImmediately ? accountId : undefined,
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
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {categories.length === 0 && <option value="">Без категории</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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

        <div className="mb-4">
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

        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={paidImmediately}
            onChange={(e) => setPaidImmediately(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-accent"
          />
          Оплачено сразу
        </label>

        {paidImmediately ? (
          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Счёт списания</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {accounts.length === 0 && <option value="">Нет доступных счетов</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="mb-5 text-xs text-muted">
            Расход сохранится как черновик — вы подтвердите и оплатите его позже, во вкладке «Расходы».
          </p>
        )}

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
