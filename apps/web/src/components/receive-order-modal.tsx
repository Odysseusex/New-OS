"use client";

import { useState } from "react";
import type { PurchaseOrderDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney, formatQuantity } from "@/lib/format";

const inputClass =
  "w-28 rounded-lg border border-border bg-surface px-3 py-2 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// Receiving an order = goods in, and (after the purchasing cutover) the debt
// for them. Quantity and price are pre-filled from the order; only what the
// user actually changed is sent, so "as ordered" stays "as ordered".
export function ReceiveOrderModal({
  order,
  onClose,
  onDone,
}: {
  order: PurchaseOrderDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState(
    order.items.map((i) => ({ id: i.id, quantity: String(i.quantity), unitCost: String(i.unitCost) })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
  const total = rows.reduce((s, r) => s + num(r.quantity) * num(r.unitCost), 0);
  const invalid = rows.some((r) => !Number.isFinite(num(r.quantity)) || !Number.isFinite(num(r.unitCost)) || num(r.quantity) < 0 || num(r.unitCost) < 0);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const items = order.items
        .map((item, idx) => {
          const row = rows[idx];
          const q = num(row.quantity);
          const c = num(row.unitCost);
          return {
            itemId: item.id,
            ...(q !== item.quantity ? { quantity: q } : {}),
            ...(c !== item.unitCost ? { unitCost: c } : {}),
          };
        })
        .filter((i) => i.quantity !== undefined || i.unitCost !== undefined);
      await api.procurement.receiveOrder(order.id, { items });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять заказ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Приёмка — ${order.supplierName}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">Товар</th>
              <th className="py-2 text-right font-medium">Заказано</th>
              <th className="py-2 text-right font-medium">Получено</th>
              <th className="py-2 text-right font-medium">Цена</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {order.items.map((item, idx) => (
              <tr key={item.id}>
                <td className="py-2 text-foreground">{item.productName}</td>
                <td className="py-2 text-right text-muted">
                  {formatQuantity(item.quantity)} × {formatMoney(item.unitCost)}
                </td>
                <td className="py-2 text-right">
                  <input
                    inputMode="decimal"
                    className={inputClass}
                    value={rows[idx].quantity}
                    onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                  />
                </td>
                <td className="py-2 text-right">
                  <input
                    inputMode="decimal"
                    className={inputClass}
                    value={rows[idx].unitCost}
                    onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, unitCost: e.target.value } : r)))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Итого по факту</span>
          <span className="font-semibold text-foreground">{formatMoney(Number.isFinite(total) ? total : 0)}</span>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={saving || invalid}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Приёмка…" : "Принять"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
