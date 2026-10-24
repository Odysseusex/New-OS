"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, Search, X } from "lucide-react";
import type { ProductDto, SaleDetailDto, SaleDto, SalesSummaryDto } from "@bakery-os/shared";
import { PAYMENT_METHOD_LABELS_RU, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney, formatQuantity } from "@/lib/format";
import { startOfZonedDay, zonedDateKey } from "@/lib/reporting-period";

// The whole business day, not a page: a busy point rings up well over a
// hundred checks, and a list cut at the latest 50 silently hid the morning.
// The server caps a request at 2000 anyway.
const DAY_LIMIT = 2000;
const PRODUCT_MATCHES_SHOWN = 8;

// Today's sales, for a cashier standing at the till: "did that one go
// through", "what was in it", "print me another copy" — and, with a product
// picked, every check today that had it, so a cashier can show which loaves
// they actually rang up.
//
// The point passed in only narrows what is asked for — it is not what keeps
// a cashier honest. The server pins a location-scoped role to its own point
// for the list, the totals and each individual sale, so a cashier physically
// cannot pull up another shop's takings by asking for
// them. The «Итого за сегодня» figure comes from the summary endpoint rather
// than by adding up the loaded list.
export function SaleHistoryModal({
  locationId,
  products,
  onClose,
  onReprint,
}: {
  // The till's current point of sale, so the list and the day's totals are
  // about the shop the cashier is standing in.
  locationId?: string;
  // The till's own product list, already loaded — searched client-side.
  products: ProductDto[];
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
  const [openError, setOpenError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<ProductDto | null>(null);

  useEffect(() => {
    api.sales
      .summary(locationId)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [locationId]);

  useEffect(() => {
    setState("loading");
    const from = startOfZonedDay(zonedDateKey()).toISOString();
    api.sales
      .list(locationId, DAY_LIMIT, undefined, from, undefined, product?.id)
      .then((list) => {
        setSales(list);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [locationId, product]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || product) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, PRODUCT_MATCHES_SHOWN);
  }, [products, query, product]);

  const productTotal = product ? sales.reduce((sum, sale) => sum + (sale.productQuantity ?? 0), 0) : 0;

  async function open(saleId: string) {
    setLoadingSaleId(saleId);
    setOpenError(null);
    try {
      setOpenSale(await api.sales.findOne(saleId));
    } catch (err) {
      // Staying on the list is safe — nothing was changed — but the tap has
      // to visibly do something, or it reads as a dead button.
      setOpenError(err instanceof Error ? err.message : "Не удалось открыть чек");
    } finally {
      setLoadingSaleId(null);
    }
  }

  if (openSale) {
    return (
      <Modal title={`Чек · ${formatTime(openSale.soldAt)}`} onClose={() => setOpenSale(null)} width="max-w-md">
        <div className="mb-4 space-y-2">
          {(openSale.items ?? []).map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-foreground">
                {item.productName}
                <span className="ml-1 text-muted">
                  {formatQuantity(item.quantity)} × {formatMoney(item.unitPrice)}
                  {/* `!= null`, not `!== null`: an API build that predates the
                      markdown field sends nothing at all, and `undefined !== null`
                      would stamp a label on every line of every old sale.
                      promotionName tells a coupon discount apart from a
                      stale-goods markdown — the same distinction the receipt
                      and markdownLoss reporting already make. */}
                  {item.fullUnitPrice != null && (
                    <span className="ml-1 text-amber-700">{item.promotionName ?? (item.loyaltyDiscount ? "баллы" : "уценка")}</span>
                  )}
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
        {/* `openSale.payments ?? []`: this dialog is the first thing a cashier
            opens after a sale, and an API server one build behind sends no
            `payments` at all — reading `.length` off that took the whole till
            screen down with «Application error». */}
        <p className="mt-1 text-sm text-muted">
          {(openSale.payments ?? []).length > 0
            ? openSale.payments
                .map((p) => `${PAYMENT_METHOD_LABELS_RU[p.method]} ${formatMoney(p.amount)}`)
                .join(" · ")
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
      {!product && summary && <TodayTotals summary={summary} />}

      <div className="mb-3">
        {product ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2">
            <span className="text-sm text-foreground">
              <span className="font-medium">{product.name}</span>
              {state === "ready" && (
                <span className="ml-1 text-muted">
                  · сегодня {formatQuantity(productTotal)} {UNIT_LABELS_RU[product.unit]} в {sales.length}{" "}
                  {checksPlural(sales.length)}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setProduct(null);
                setQuery("");
              }}
              aria-label="Сбросить товар"
              className="rounded-lg p-1 text-muted transition hover:bg-surface-muted hover:text-foreground"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти чеки с товаром"
              className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}
        {/* Inline, not a floating dropdown: nothing here needs to intercept
            Escape before the Modal does. */}
        {matches.length > 0 && (
          <ul className="mt-1 space-y-0.5 rounded-xl border border-border p-1">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setProduct(p)}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-foreground transition hover:bg-surface-muted"
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && !product && matches.length === 0 && (
          <p className="mt-1 px-1 text-sm text-muted">Товар не найден</p>
        )}
      </div>

      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && <p className="text-sm text-red-700">Не удалось загрузить историю</p>}

      {state === "ready" && (
        <>
          {openError && (
            <p className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{openError}</p>
          )}

          {sales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {product ? "Сегодня этот товар не пробивали" : "Продаж пока не было"}
            </p>
          ) : (
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <button
                    onClick={() => open(sale.id)}
                    disabled={loadingSaleId === sale.id}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-muted disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-foreground">{formatTime(sale.soldAt)}</span>
                      <span className="ml-2 text-xs text-muted">
                        {product && sale.productQuantity != null && (
                          <span className="font-medium text-foreground">
                            {formatQuantity(sale.productQuantity)} {UNIT_LABELS_RU[product.unit]} ·{" "}
                          </span>
                        )}
                        {sale.itemsCount} поз. · {PAYMENT_METHOD_LABELS_RU[sale.paymentMethod]} · {sale.createdByName}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-foreground">
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

// The day's takings, split the way the cashier has to count them: the drawer
// on one line, the terminal on another. «Итого» is what was actually taken —
// the tenders less anything refunded — so it can be compared against what is
// physically there rather than against what was sold.
//
// `?? []` and `?? 0` throughout: an API server one build behind sends none of
// these fields, and the till must degrade to the old single total rather than
// crash on it.
function TodayTotals({ summary }: { summary: SalesSummaryDto }) {
  const takings = summary.todayTakings ?? [];
  const refunds = summary.todayRefunds ?? 0;
  const unpaid = summary.todayUnpaid ?? 0;
  const total = takings.reduce((sum, row) => sum + row.amount, 0) - refunds;

  return (
    <div className="mb-4 rounded-xl bg-surface-muted px-4 py-3">
      <p className="text-sm text-muted">
        Сегодня · {summary.todaySalesCount} {plural(summary.todaySalesCount)}
      </p>

      {takings.length > 0 && (
        <div className="mt-2 space-y-1">
          {takings.map((row) => (
            <div key={row.method} className="flex items-baseline justify-between text-sm">
              <span className="text-muted">{PAYMENT_METHOD_LABELS_RU[row.method]}</span>
              <span className="font-medium text-foreground">{formatMoney(row.amount)}</span>
            </div>
          ))}
          {refunds > 0 && (
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted">Возвраты</span>
              <span className="font-medium text-red-700">−{formatMoney(refunds)}</span>
            </div>
          )}
          {unpaid > 0 && (
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted">В долг</span>
              <span className="font-medium text-foreground">{formatMoney(unpaid)}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-sm text-muted">Итого</span>
        <span className="text-xl font-semibold text-foreground">
          {formatMoney(takings.length > 0 ? total : summary.todayRevenue)}
        </span>
      </div>
    </div>
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

function checksPlural(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "чеке";
  return "чеках";
}
