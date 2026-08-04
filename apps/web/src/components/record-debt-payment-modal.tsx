"use client";

import { useState } from "react";
import type { CashAccountDto } from "@bakery-os/shared";
import { ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney } from "@/lib/format";

// Generic "pay down this debt" modal — used for both a supplier invoice and
// an internal expense, since both are just "amount + which account it left
// from" once confirmed. The caller supplies the actual API call.
export function RecordDebtPaymentModal({
  title,
  balanceDue,
  accounts,
  onClose,
  onSubmit,
}: {
  title: string;
  balanceDue: number;
  accounts: CashAccountDto[];
  onClose: () => void;
  onSubmit: (amount: number, accountId: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(balanceDue));
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) return;
    if (value > balanceDue) {
      setError("Сумма превышает остаток задолженности");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit(value, accountId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести оплату");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width="max-w-sm">
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-muted">Остаток задолженности: {formatMoney(balanceDue)}</p>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Сумма, ₸</label>
          <input
            type="number"
            min="0"
            max={balanceDue}
            step="any"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

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

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting || !accountId}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Оплата…" : "Оплатить"}
        </button>
      </form>
    </Modal>
  );
}
