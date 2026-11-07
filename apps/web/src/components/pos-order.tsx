"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import type { OpenCrmOrderDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

// «Оплата заказа» on the till: the check pays for a cake order (a prepayment or the rest), so the
// sale counts in the «Заказы» business direction. Opened from the check's toolbar.
export function PosOrderPickerModal({ onPick, onClose }: { onPick: (o: OpenCrmOrderDto) => void; onClose: () => void }) {
  const [orders, setOrders] = useState<OpenCrmOrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.sales
      .openOrders()
      .then(setOrders)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить заказы"));
  }, []);
  return (
    <Modal title="Оплата заказа" onClose={onClose} width="max-w-lg">
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!orders && !error && <p className="text-sm text-muted">Загрузка…</p>}
      {orders && orders.length === 0 && <p className="py-6 text-center text-sm text-muted">Открытых заказов нет</p>}
      {orders && orders.length > 0 && (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {orders.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => onPick(o)}
                className="w-full rounded-2xl border border-border px-4 py-3 text-left transition hover:border-accent hover:bg-surface-muted"
              >
                <span className="block text-base font-semibold text-foreground">
                  №{o.number} · {o.title}
                </span>
                <span className="mt-0.5 block text-sm text-muted">
                  {o.customerName} · к {formatDate(o.dueAt)}
                  {o.price !== null ? ` · ${formatMoney(o.price)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
