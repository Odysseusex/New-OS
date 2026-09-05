"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { SaleDetailDto, SaleDto, SalesSummaryDto } from "@bakery-os/shared";
import { PAYMENT_METHOD_LABELS_RU } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney, formatQuantity } from "@/lib/format";

const PAGE_SIZE = 50;

// Recent sales, for a cashier standing at the till: "did that one go
// through", "what was in it", "print me another copy".
//
// Nothing here is scoped on the client — the server pins a location-scoped
// role to its own point for both the list and each individual sale, so a
// cashier physically cannot pull up another shop's takings by asking for
// them. The «Итого за сегодня» figure comes from the summary endpoint rather
// than by adding up the loaded page, which would quietly understate a busy
// day once it ran past PAGE_SIZE.
export function SaleHistoryModal({
  onClose,
  onReprint,
}: {
  onClose: () => void;
  // Handed back to the till, which owns the printable slip and has to close
  // this dialog before printing — otherwise the print would capture the
  // dialog sitting on top of the receipt.
  onReprint: (sale: SaleDetailDto) => void;
}) {
  const [sales, setSales] = useState<SaleDto[]>([]);
  const [summary, setSummary] = useState<SalesSummaryDto | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [openSale, setOpenSale] = useState<SaleDetailDto | null>(null);
  const [loadingSaleId, setLoadingSaleId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.sales.list(undefined, PAGE_SIZE), api.sales.summary()])
      .then(([list, s]) => {
        setSales(list);
        setSummary(s);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  async function open(saleId: string) {
    setLoadingSaleId(saleId);
    try {
      setOpenSale(await api.sales.findOne(saleId));
    } catch {
      // Falling back to the list is enough: nothing was changed, and the
      // cashier can simply tap again.
    } finally {
      setLoadingSaleId(null);
    }
  }

  if (openSale) {
    return (
      <Modal title={`Чек · ${formatTime(openSale.soldAt)}`} onClose={() => setOpenSale(null)} width="max-w-md">
        <div className="mb-4 space-y-2">
          {openSale.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-foreground">
                {item.productName}
                <span className="ml-1 text-muted">
                  {formatQuantity(item.quantity)} × {formatMoney(item.unitPrice)}
                </span>
              </span>
              <span className="font-medium text-foreground">{formatMoney(item.subtotal)}</span>
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm text-muted">Итого</span>
          <span className="text-xl font-semibold text-foreground">{formatMoney(openSale.totalAmount)}</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {openSale.payments.length > 0
            ? openSale.payments.map((p) => `${PAYMENT_METHOD_LABELS_RU[p.method]} ${formatMoney(p.amount)}`).join(" · ")
            : PAYMENT_METHOD_LABELS_RU[openSale.paymentMethod]}
        </p>

        <button
          type="button"
          onClick={() => onReprint(openSale)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90"
        >
          <Printer className="h-4 w-4" strokeWidth={1.75} />
          Напечатать ещё раз
        </button>
        <button
          type="button"
          onClick={() => setOpenSale(null)}
          className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-muted"
        >
          Назад к списку
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="История продаж" onClose={onClose} width="max-w-lg">
      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && <p className="text-sm text-red-700">Не удалось загрузить историю</p>}

      {state === "ready" && (
        <>
          {summary && (
            <div className="mb-4 flex items-baseline justify-between rounded-xl bg-surface-muted px-4 py-3">
              <span className="text-sm text-muted">
                Сегодня · {summary.todaySalesCount} {plural(summary.todaySalesCount)}
              </span>
              <span className="text-xl font-semibold text-foreground">
                {formatMoney(summary.todayRevenue)}
              </span>
            </div>
          )}

          {sales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Продаж пока не было</p>
          ) : (
            <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <button
                    onClick={() => open(sale.id)}
                    disabled={loadingSaleId === sale.id}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-muted disabled:opacity-50"
                  >
                    <span>
                      <span className="text-sm font-medium text-foreground">{formatTime(sale.soldAt)}</span>
                      <span className="ml-2 text-xs text-muted">
                        {sale.itemsCount} поз. · {PAYMENT_METHOD_LABELS_RU[sale.paymentMethod]}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {formatMoney(sale.totalAmount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

// Time alone for today's sales, date and time for anything older — a till
// list is read at a glance and is almost entirely today.
function formatTime(iso: string): string {
  const date = new Date(iso);
  const isToday = new Date().toDateString() === date.toDateString();
  return isToday
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function plural(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "продажа";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "продажи";
  return "продаж";
}
