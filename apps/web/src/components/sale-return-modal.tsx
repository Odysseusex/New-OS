"use client";

import { useMemo, useState } from "react";
import type { SaleDetailDto, SaleReturnDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney, formatQuantity } from "@/lib/format";

export function SaleReturnModal({
  sale,
  previousReturns,
  onClose,
  onReturned,
}: {
  sale: SaleDetailDto;
  previousReturns: SaleReturnDto[];
  onClose: () => void;
  onReturned: () => void;
}) {
  // How much of each line is still returnable, after everything earlier
  // returns already took back.
  const remainingByProduct = useMemo(() => {
    const sold = new Map<string, number>();
    for (const item of sale.items) {
      sold.set(item.productId, (sold.get(item.productId) ?? 0) + item.quantity);
    }
    for (const done of previousReturns) {
      for (const item of done.items) {
        sold.set(item.productId, (sold.get(item.productId) ?? 0) - item.quantity);
      }
    }
    return sold;
  }, [sale.items, previousReturns]);

  const returnable = sale.items.filter((item) => (remainingByProduct.get(item.productId) ?? 0) > 0);

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [restocked, setRestocked] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = returnable
    .map((item) => ({ item, quantity: Number(quantities[item.productId] ?? "") }))
    .filter((l) => l.quantity > 0);
  const total = lines.reduce((sum, l) => sum + l.quantity * l.item.unitPrice, 0);

  async function handleSubmit() {
    if (lines.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.sales.returns.create(sale.id, {
        items: lines.map((l) => ({ productId: l.item.productId, quantity: l.quantity })),
        reason: reason.trim() || undefined,
        restocked,
      });
      onReturned();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось оформить возврат");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Возврат от покупателя" onClose={onClose} width="max-w-xl">
      {returnable.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">По этой продаже всё уже возвращено.</p>
      ) : (
        <>
          <div className="mb-5 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">Товар</th>
                  <th className="px-4 py-2.5 text-right font-medium">Доступно</th>
                  <th className="px-4 py-2.5 text-right font-medium">К возврату</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {returnable.map((item) => {
                  const max = remainingByProduct.get(item.productId) ?? 0;
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 text-foreground">
                        {item.productName}
                        <span className="ml-2 text-xs text-muted">{formatMoney(item.unitPrice)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted">{formatQuantity(max)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input
                          type="number"
                          min={0}
                          max={max}
                          step="any"
                          value={quantities[item.productId] ?? ""}
                          onChange={(e) =>
                            setQuantities((current) => ({ ...current, [item.productId]: e.target.value }))
                          }
                          placeholder="0"
                          className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label className="mb-4 flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={restocked}
              onChange={(e) => setRestocked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span className="text-foreground">
              Товар вернулся на склад
              {!restocked && (
                // A data message, not a lecture: the ledger will differ.
                <span className="mt-0.5 block text-xs text-amber-700">Товар будет списан, а не возвращён в остатки</span>
              )}
            </span>
          </label>

          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Причина <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: не подошёл товар"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="mb-5 flex items-end justify-between rounded-xl bg-surface-muted px-4 py-3">
            <span className="text-sm text-muted">К возврату</span>
            <span className="text-xl font-semibold text-foreground">{formatMoney(total)}</span>
          </div>

          {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={lines.length === 0 || isSubmitting}
              className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
            >
              {isSubmitting ? "Оформляем…" : "Оформить возврат"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
