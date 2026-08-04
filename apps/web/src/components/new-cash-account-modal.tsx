"use client";

import { useState } from "react";
import type { LocationDto } from "@bakery-os/shared";
import { CashAccountType } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function NewCashAccountModal({
  locations,
  onClose,
  onCreated,
}: {
  locations: LocationDto[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<CashAccountType>(CashAccountType.BANK);
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [isDefault, setIsDefault] = useState(false);
  const [openingBalance, setOpeningBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.finance.accounts.create({
        name,
        type,
        locationId: type === CashAccountType.CASH ? locationId : undefined,
        isDefault: type === CashAccountType.BANK ? isDefault : undefined,
        openingBalance: openingBalance ? Number(openingBalance) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать счёт");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Новый счёт" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
          {([CashAccountType.BANK, CashAccountType.CASH] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg py-2 text-sm font-medium transition ${
                type === t ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {t === CashAccountType.BANK ? "Банковский счёт" : "Касса"}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            required
            autoFocus
            placeholder={type === CashAccountType.BANK ? "Расчётный счёт" : "Касса точки"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {type === CashAccountType.CASH && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Точка</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Начальный остаток, ₸ <span className="text-muted">(необязательно)</span>
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {type === CashAccountType.BANK && (
          <label className="mb-5 flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            Использовать по умолчанию для безналичных продаж
          </label>
        )}

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : "Создать счёт"}
        </button>
      </form>
    </Modal>
  );
}
