"use client";

import { useState } from "react";
import { ClipboardList, X } from "lucide-react";
import type { OpenCrmOrderDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

// «Оплата заказа» on the till: the check pays for a cake order (a prepayment
// or the rest), so the sale counts in the «Заказы» business direction.
export function PosOrderBlock({ order, onChange }: { order: OpenCrmOrderDto | null; onChange: (o: OpenCrmOrderDto | null) => void }) {
  const [orders, setOrders] = useState<OpenCrmOrderDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function show() {
    setOpen(true);
    setError(null);
    api.sales
      .openOrders()
      .then(setOrders)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить заказы"));
  }

  if (order) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-accent">
            Заказ №{order.number} · {order.title}
          </p>
          <p className="truncate text-xs text-muted">
            {order.customerName} · к {formatDate(order.dueAt)}
            {order.price !== null ? ` · ${formatMoney(order.price)}` : ""}
          </p>
        </div>
        <button onClick={() => onChange(null)} title="Убрать заказ" className="shrink-0 rounded-lg p-1 text-muted hover:text-foreground">
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={show} className="flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-foreground">
        <ClipboardList className="h-4 w-4" strokeWidth={1.75} />
        Оплата заказа
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Заказ, за который оплата</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-foreground">
          Скрыть
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!orders && !error && <p className="text-xs text-muted">Загрузка…</p>}
      {orders && orders.length === 0 && <p className="text-xs text-muted">Открытых заказов нет</p>}
      {orders && orders.length > 0 && (
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {orders.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-sm transition hover:bg-surface-muted"
              >
                <span className="font-medium text-foreground">
                  №{o.number} · {o.title}
                </span>
                <span className="block text-xs text-muted">
                  {o.customerName} · к {formatDate(o.dueAt)}
                  {o.price !== null ? ` · ${formatMoney(o.price)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
