"use client";

import { useState } from "react";
import clsx from "clsx";
import type { CashAccountDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

type Direction = "in" | "out";

// One modal for both directions ("создание прихода денег" and cash
// withdrawal) — a single toggle instead of two separate flows, so logging
// either takes the same three fields either way.
export function CashMovementModal({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: CashAccountDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [direction, setDirection] = useState<Direction>("in");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const dto = { accountId, amount: Number(amount), reason: reason || undefined };
      if (direction === "in") {
        await api.finance.movements.deposit(dto);
      } else {
        await api.finance.movements.withdraw(dto);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить операцию");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Деньги на счёт / со счёта" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4 flex gap-1 rounded-xl bg-surface-muted p-1">
          <button
            type="button"
            onClick={() => setDirection("in")}
            className={clsx(
              "flex-1 rounded-lg py-2 text-sm font-medium transition",
              direction === "in" ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            Внести
          </button>
          <button
            type="button"
            onClick={() => setDirection("out")}
            className={clsx(
              "flex-1 rounded-lg py-2 text-sm font-medium transition",
              direction === "out" ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            Снять
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Счёт</label>
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

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Сумма, ₸</label>
          <input
            type="number"
            min="0"
            step="any"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Комментарий <span className="text-muted">(необязательно)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting || !accountId}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : direction === "in" ? "Внести деньги" : "Снять деньги"}
        </button>
      </form>
    </Modal>
  );
}
