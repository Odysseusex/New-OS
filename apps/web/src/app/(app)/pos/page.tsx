"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Banknote, CreditCard, History, Minus, Plus, Printer, ScanLine, Split, Trash2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { CategoryDto, LocationDto, ProductDto, SaleDetailDto, SaleFiscalReceiptDto } from "@bakery-os/shared";
import {
  FiscalReceiptStatus,
  ORG_WIDE_ROLES,
  PAYMENT_METHOD_LABELS_RU,
  PaymentMethod,
  ProductType,
  SALE_CREATE_ROLES,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { Modal } from "@/components/modal";
import { NumberPad } from "@/components/number-pad";
import { SaleHistoryModal } from "@/components/sale-history-modal";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney, formatQuantity } from "@/lib/format";

// A cart line carries its own price rather than reading it off the product,
// because an open-price line's amount is typed by the cashier and two such
// lines in one order are different amounts of the same product row. `key` is
// what identifies a line in the cart — product.id for catalogue items, a
// minted id for open-price ones, so they never merge into each other.
interface CartLine {
  key: string;
  product: ProductDto;
  quantity: number;
  unitPrice: number;
}

// Payment buttons at the till. Deliberately no "в долг" option: a walk-in
// sale is settled on the spot, and a credit sale belongs to a named customer,
// which is what the Продажи form is for.
// Which payment dialog is open. `null` = none.
type PayMode = "cash" | "card" | "mixed";

const PAYMENT_BUTTONS: { mode: PayMode; label: string; icon: typeof Banknote }[] = [
  { mode: "cash", label: "Наличные", icon: Banknote },
  { mode: "card", label: "Карта", icon: CreditCard },
  { mode: "mixed", label: "Картой и наличными", icon: Split },
];

export default function PosPage() {
  const { user } = useAuth();
  const canSell = user ? SALE_CREATE_ROLES.includes(user.role) : false;
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // The fiscal receipt for the sale just rung up. Unlike `flash` this does
  // NOT time out: the buyer may want to scan the QR, and a receipt number
  // that vanishes after four seconds is worse than none at all.
  const [receipt, setReceipt] = useState<{ amount: number; fiscal: SaleFiscalReceiptDto } | null>(null);
  // The full sale just rung up, kept regardless of fiscalisation state — a
  // printed slip for the buyer is a separate capability from a fiscal
  // receipt, and useful even with FISCALIZATION_ENABLED off (which is every
  // sale so far). Feeds the print-only block below; the on-screen flash/
  // ReceiptPanel above it stay exactly as they were.
  const [lastSale, setLastSale] = useState<SaleDetailDto | null>(null);
  // The catalogue row behind «Произвольная сумма». Null until it loads (or if
  // it fails to) — the button is simply not offered in that case rather than
  // failing at payment time.
  const [openPriceProduct, setOpenPriceProduct] = useState<ProductDto | null>(null);
  const [openPriceOpen, setOpenPriceOpen] = useState(false);
  const [payMode, setPayMode] = useState<PayMode | null>(null);
  // Cash handed over and change due for the sale just rung up, kept only long
  // enough to print them on the slip. Deliberately not persisted: the server
  // records what the sale cost, not which note the buyer produced.
  const [cashDetails, setCashDetails] = useState<{ given: number; change: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // An older sale the cashier asked for another copy of. Takes precedence
  // over `lastSale` on the printable slip, and clears itself once printed.
  const [reprintSale, setReprintSale] = useState<SaleDetailDto | null>(null);

  const scanRef = useRef<HTMLInputElement>(null);

  // The scan box must own the keyboard: a USB scanner is just a keyboard that
  // types very fast and presses Enter, so whatever is focused receives the
  // barcode. Pulling focus back after every tap keeps a scan working even
  // once the cashier has been clicking tiles.
  const focusScan = useCallback(() => scanRef.current?.focus(), []);

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    api.locations.list().then(setLocations).catch(() => {});
    // Created on the server the first time any till asks; a failure here just
    // means the button is not offered.
    api.products.openPrice().then(setOpenPriceProduct).catch(() => {});
  }, []);

  // Reloaded whenever the point of sale changes, because the price depends on
  // it: the retail point charges its own prices, everywhere else charges the
  // organization's default. Waits for a location rather than loading the
  // defaults first, so the grid never briefly shows the wrong prices.
  useEffect(() => {
    if (!locationId) return;
    // A sale moves finished goods; raw materials are never rung up at a till.
    // The open-price row is filtered out too — it gets its own button rather
    // than sitting in the grid as a meaningless 0 ₸ tile.
    api.products
      .list(false, locationId)
      .then((all) =>
        setProducts(all.filter((p) => p.isActive && p.type === ProductType.FINISHED_GOOD && !p.isOpenPrice)),
      )
      .catch(() => setError("Не удалось загрузить товары"));
    // A part-built order belongs to the point it was priced at. Carrying it
    // across would keep the old prices while the grid shows new ones.
    setCart([]);
  }, [locationId]);

  // A location-scoped cashier sells at their own point and nowhere else.
  // They deliberately do NOT fall back to locations[0] when unassigned: that
  // silently sold at whichever point sorted first alphabetically, using ITS
  // prices, with no picker on their screen to reveal or correct it. Refusing
  // to guess turns an invisible wrong price into an obvious blocked till.
  useEffect(() => {
    if (locationId) return;
    if (!isOrgWide) {
      if (user?.locationId) setLocationId(user.locationId);
      return;
    }
    if (locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId, isOrgWide, user]);

  const activeLocationName = locations.find((l) => l.id === locationId)?.name ?? null;
  const missingLocation = !isOrgWide && !user?.locationId;

  useEffect(focusScan, [focusScan]);

  // Typing anywhere on the page (including a scan arriving while focus sits on
  // a tile) is redirected into the scan box, so nothing is ever swallowed.
  useEffect(() => {
    // While an amount dialog is open the keypad owns the keyboard — pulling
    // focus back to the scan box would send the cashier's digits into the
    // product search instead of into the amount.
    // History is included for a different reason than the amount dialogs: a
    // scanner firing while the cashier is looking at past receipts would
    // otherwise type into the search box behind the dialog and quietly drop
    // a product into the cart nobody asked for.
    if (openPriceOpen || historyOpen || payMode !== null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) focusScan();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusScan, openPriceOpen, historyOpen, payMode]);

  // Only categories that actually hold something sellable. Without this the
  // till offers chips like «Сырьё», which can only ever show an empty grid,
  // since raw materials are never rung up here.
  const sellableCategories = useMemo(() => {
    const usedIds = new Set(products.map((p) => p.categoryId).filter(Boolean));
    return categories.filter((c) => c.isActive && usedIds.has(c.id));
  }, [categories, products]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(() => {
    let list = products;
    if (categoryId) list = list.filter((p) => p.categoryId === categoryId);
    if (normalizedQuery) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(normalizedQuery) ||
          (p.sku ?? "").toLowerCase().includes(normalizedQuery) ||
          (p.barcode ?? "").toLowerCase().includes(normalizedQuery),
      );
    }
    return list;
  }, [products, categoryId, normalizedQuery]);

  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  function addToCart(product: ProductDto, step = 1) {
    setCart((current) => {
      const existing = current.find((line) => line.key === product.id);
      if (!existing) {
        // effectivePrice, not price: what this point of sale charges, which
        // for the retail point is not the organization's default.
        return [...current, { key: product.id, product, quantity: step, unitPrice: product.effectivePrice }];
      }
      return current.map((line) =>
        line.key === product.id ? { ...line, quantity: line.quantity + step } : line,
      );
    });
    setError(null);
    // The previous buyer's confirmation must not still be on screen while the
    // next order is being rung up. Starting the next order is the main way
    // it gets cleared — «Без чека» is for when the cashier wants the screen
    // clean before that.
    setReceipt(null);
    setFlash(null);
  }

  // Its own line every time, never merged with an earlier one: two open-price
  // entries in one order are two different goods that happen to share a
  // catalogue row.
  function addOpenPriceLine(amount: number) {
    if (!openPriceProduct) return;
    setCart((current) => [
      ...current,
      {
        key: `open-${Date.now()}-${current.length}`,
        product: openPriceProduct,
        quantity: 1,
        unitPrice: amount,
      },
    ]);
    setError(null);
    setReceipt(null);
    setFlash(null);
  }

  function setLineQuantity(key: string, quantity: number) {
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.key !== key)
        : current.map((line) => (line.key === key ? { ...line, quantity } : line)),
    );
  }

  // Enter is what a scanner presses after the digits. An exact barcode match
  // wins over a name match: a scanned code must never be ambiguous just
  // because some product name happens to contain the same digits.
  function handleScanSubmit() {
    const raw = query.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();

    const byBarcode = products.filter((p) => (p.barcode ?? "").toLowerCase() === lower);
    if (byBarcode.length === 1) {
      addToCart(byBarcode[0]);
      setQuery("");
      return;
    }
    if (byBarcode.length > 1) {
      setError(`Штрихкод ${raw} привязан к нескольким товарам — исправьте в номенклатуре`);
      setQuery("");
      return;
    }

    if (visibleProducts.length === 1) {
      addToCart(visibleProducts[0]);
      setQuery("");
      return;
    }
    if (visibleProducts.length === 0) {
      setError(`Товар «${raw}» не найден`);
      // The box must end up empty even when the scan failed: a scanner types
      // straight into it, so a leftover code would prepend itself to the next
      // scan ("0000…" + "4870…") and ring up the wrong product entirely.
      setQuery("");
    }
  }

  // `cashGiven` is the note the buyer handed over — it is never sent to the
  // server (a walk-in sale is always settled in full, so `amountPaid` is the
  // total either way); it exists only to work out the change and to put both
  // numbers on the printed slip. `split` IS sent: it decides which accounts
  // the money lands in.
  async function handlePay(
    method: PaymentMethod,
    cashGiven?: number,
    split?: { method: PaymentMethod; amount: number }[],
  ) {
    if (cart.length === 0 || !locationId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const sale = await api.sales.create({
        locationId,
        paymentMethod: method,
        ...(split ? { payments: split } : {}),
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
      // With fiscalisation off there is no receipt, and the short green
      // flash is the whole confirmation — exactly as before.
      if (sale.fiscalReceipt) {
        setReceipt({ amount: total, fiscal: sale.fiscalReceipt });
      } else {
        const change = cashGiven !== undefined ? cashGiven - total : 0;
        setFlash(
          change > 0
            ? `Продажа проведена — ${formatMoney(total)}. Сдача ${formatMoney(change)}`
            : `Продажа проведена — ${formatMoney(total)}`,
        );
      }
      setLastSale(sale);
      setCashDetails(cashGiven !== undefined ? { given: cashGiven, change: cashGiven - total } : null);
      setCart([]);
      setQuery("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести продажу");
    } finally {
      setIsSubmitting(false);
      focusScan();
    }
  }

  // Reprinting an older receipt is deferred by a beat so the history dialog
  // is really gone from the document first — window.print() captures the DOM
  // as it stands, and printing over an open dialog would put the dialog on
  // the slip. The flag is cleared inside the timeout, not in the effect body:
  // clearing it here would re-run the effect and its own cleanup would cancel
  // the print before it fired.
  useEffect(() => {
    if (!reprintSale) return;
    const timer = setTimeout(() => {
      window.print();
      setReprintSale(null);
    }, 50);
    return () => clearTimeout(timer);
  }, [reprintSale]);

  if (user && !canSell) {
    return <p className="mx-auto max-w-6xl text-sm text-muted">У вас нет прав на оформление продаж.</p>;
  }

  return (
    <>
    <div className="mx-auto max-w-7xl print:hidden">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Касса</h1>
          <p className="mt-1 text-sm text-muted">Продажа на точке: сканирование, корзина, оплата</p>
        </div>
        {/* Which point this till is selling at is shown to EVERYONE, not just
            to whoever may switch it. Prices differ per point, so a cashier
            who cannot see the point cannot tell the prices are the wrong
            ones — which is exactly how a till ended up quietly selling at
            another shop's prices. */}
        <div className="flex items-center gap-2">
        {/* The till is the only screen a cashier can reach, so checking what
            was already sold has to live here — the Продажи module is closed
            to them by design. */}
        <button
          onClick={() => setHistoryOpen(true)}
          className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
        >
          <History className="h-4 w-4" strokeWidth={1.75} />
          История
        </button>
        {isOrgWide ? (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        ) : (
          activeLocationName && (
            <div className="rounded-xl border border-border bg-surface px-3 py-2 text-sm">
              <span className="text-muted">Точка: </span>
              <span className="font-medium text-foreground">{activeLocationName}</span>
            </div>
          )
        )}
        </div>
      </div>

      {missingLocation && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Вам не назначена точка продаж, поэтому касса не знает, по каким ценам продавать. Обратитесь к
          владельцу — точка указывается в Настройках, в карточке сотрудника.
        </div>
      )}

      {/* Deliberately has no timeout. The cashier asks the buyer whether they
          want a slip, and that conversation routinely outlasts any timer — a
          confirmation that disappears mid-question is the one thing this bar
          must not do. It clears when the next order is started, or when the
          cashier presses «Без чека». Printing does not clear it, so a jammed
          or empty printer can simply be printed to again. */}
      {flash && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          <span>{flash}</span>
          {lastSale && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
                Печать
              </button>
              <button
                onClick={() => {
                  setFlash(null);
                  focusScan();
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
              >
                Без чека
              </button>
            </div>
          )}
        </div>
      )}
      {receipt && (
        <ReceiptPanel
          amount={receipt.amount}
          fiscal={receipt.fiscal}
          onClose={() => setReceipt(null)}
          onPrint={() => window.print()}
        />
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Скрыть ошибку" className="shrink-0">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="relative mb-4">
            <ScanLine
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
              strokeWidth={1.75}
            />
            <input
              ref={scanRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScanSubmit();
                }
              }}
              placeholder="Отсканируйте товар или начните вводить название…"
              className="w-full rounded-2xl border border-border bg-surface py-4 pl-12 pr-4 text-base text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
            <CategoryChip active={categoryId === ""} onClick={() => setCategoryId("")}>
              Все
            </CategoryChip>
            {sellableCategories.map((c) => (
              <CategoryChip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                {c.name}
              </CategoryChip>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {/* Also gated on a location: without one nothing can be sold at
                all, and an open-price line would only fill a cart whose
                payment buttons silently do nothing. */}
            {openPriceProduct && locationId && (
              <button
                onClick={() => setOpenPriceOpen(true)}
                className="flex h-28 flex-col justify-between rounded-2xl border border-dashed border-accent bg-surface p-3 text-left transition hover:shadow-card active:scale-[0.98]"
              >
                <span className="line-clamp-3 text-sm font-medium text-foreground">Произвольная сумма</span>
                <span className="text-sm font-semibold text-accent">Ввести вручную</span>
              </button>
            )}
            {visibleProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  addToCart(p);
                  focusScan();
                }}
                className="flex h-28 flex-col justify-between rounded-2xl border border-border bg-surface p-3 text-left transition hover:border-accent hover:shadow-card active:scale-[0.98]"
              >
                <span className="line-clamp-3 text-sm font-medium text-foreground">{p.name}</span>
                <span className="text-sm font-semibold text-accent">{formatMoney(p.effectivePrice)}</span>
              </button>
            ))}
            {visibleProducts.length === 0 && (
              <p className="col-span-full py-12 text-center text-sm text-muted">
                {normalizedQuery ? "Ничего не найдено" : "Нет товаров для продажи"}
              </p>
            )}
          </div>
        </div>

        <div className="flex h-fit flex-col rounded-2xl border border-border bg-surface shadow-card lg:sticky lg:top-4">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Чек</h2>
            {cart.length > 0 && (
              <button
                onClick={() => {
                  setCart([]);
                  focusScan();
                }}
                className="text-xs font-medium text-muted transition hover:text-foreground"
              >
                Очистить
              </button>
            )}
          </div>

          <div className="max-h-[45vh] overflow-y-auto">
            {cart.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted">Отсканируйте или выберите товар</p>
            ) : (
              cart.map((line) => (
                <div key={line.key} className="border-b border-border px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {line.product.name}
                      {line.product.isOpenPrice && (
                        <span className="ml-1 text-muted">· {formatMoney(line.unitPrice)}</span>
                      )}
                    </span>
                    <button
                      onClick={() => setLineQuantity(line.key, 0)}
                      aria-label={`Убрать ${line.product.name}`}
                      className="shrink-0 text-muted transition hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <QtyButton
                        onClick={() => setLineQuantity(line.key, line.quantity - 1)}
                        label={`Меньше ${line.product.name}`}
                      >
                        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
                      </QtyButton>
                      <span className="min-w-[3rem] text-center text-sm font-medium text-foreground">
                        {formatQuantity(line.quantity)} {UNIT_LABELS_RU[line.product.unit]}
                      </span>
                      <QtyButton
                        onClick={() => setLineQuantity(line.key, line.quantity + 1)}
                        label={`Больше ${line.product.name}`}
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      </QtyButton>
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {formatMoney(line.unitPrice * line.quantity)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border px-5 py-4">
            <div className="mb-4 flex items-end justify-between">
              <span className="text-sm text-muted">Итого{itemCount > 0 ? ` · ${formatQuantity(itemCount)} шт` : ""}</span>
              <span className="text-2xl font-semibold text-foreground">{formatMoney(total)}</span>
            </div>
            {/* Every button opens a dialog rather than settling on the spot:
                a stray tap must never be a completed sale, and the cashier
                gets one place to change their mind. */}
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_BUTTONS.map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => setPayMode(mode)}
                  disabled={cart.length === 0 || isSubmitting || !locationId}
                  className={clsx(
                    "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition hover:opacity-90 disabled:opacity-40",
                    mode === "mixed"
                      ? "col-span-2 border border-border bg-surface text-foreground hover:bg-surface-muted"
                      : "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {isSubmitting ? "…" : label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    {payMode === "cash" && (
      <CashPaymentModal
        total={total}
        isSubmitting={isSubmitting}
        onClose={() => {
          setPayMode(null);
          focusScan();
        }}
        onSubmit={(given) => {
          setPayMode(null);
          handlePay(PaymentMethod.CASH, given);
        }}
      />
    )}
    {payMode === "card" && (
      <CardPaymentModal
        total={total}
        isSubmitting={isSubmitting}
        onClose={() => {
          setPayMode(null);
          focusScan();
        }}
        onSubmit={() => {
          setPayMode(null);
          handlePay(PaymentMethod.CARD);
        }}
      />
    )}
    {payMode === "mixed" && (
      <MixedPaymentModal
        total={total}
        isSubmitting={isSubmitting}
        onClose={() => {
          setPayMode(null);
          focusScan();
        }}
        onSubmit={(card, cashPart, cashGiven) => {
          setPayMode(null);
          handlePay(PaymentMethod.MIXED, cashGiven, [
            { method: PaymentMethod.CARD, amount: card },
            { method: PaymentMethod.CASH, amount: cashPart },
          ]);
        }}
      />
    )}
    {openPriceOpen && (
      <OpenPriceModal
        onClose={() => {
          setOpenPriceOpen(false);
          focusScan();
        }}
        onSubmit={(amount) => {
          addOpenPriceLine(amount);
          setOpenPriceOpen(false);
          focusScan();
        }}
      />
    )}
    {historyOpen && (
      <SaleHistoryModal
        onClose={() => {
          setHistoryOpen(false);
          focusScan();
        }}
        onReprint={(sale) => {
          // Close first, print after: the dialog would otherwise end up on
          // the printed slip.
          setHistoryOpen(false);
          setReprintSale(sale);
        }}
      />
    )}
    {/* A reprint wins over the sale just rung up, and carries no cash
        details — how much was handed over is not stored, and inventing it
        on a reprint would put a made-up «Сдача» on a real receipt. */}
    {(reprintSale ?? lastSale) && (
      <PrintableReceipt
        sale={(reprintSale ?? lastSale)!}
        cash={reprintSale ? null : cashDetails}
        orgName={user?.organization.name ?? ""}
      />
    )}
    </>
  );
}

// Takes the cash handed over and shows the change before the sale is put
// through, so the cashier never has to reach for a calculator with a queue
// waiting. The quick buttons cover what actually gets handed over: the exact
// amount, and the notes just above it.
function CashPaymentModal({
  total,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  total: number;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (given: number) => void;
}) {
  const [value, setValue] = useState("");
  const given = value ? Number(value) : 0;
  const change = given - total;
  // Handing over less than the price is not a sale this screen can settle —
  // a walk-in sale is paid in full. Exactly the price is fine (no change).
  const valid = given >= total;
  const submit = () => {
    if (valid && !isSubmitting) onSubmit(given);
  };

  return (
    <Modal title="Оплата наличными" onClose={onClose} width="max-w-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-muted">К оплате</span>
        <span className="text-xl font-semibold text-foreground">{formatMoney(total)}</span>
      </div>

      <div className="rounded-xl border border-border bg-surface-muted px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Получено</span>
          {/* Plain text, never an <input>: an input is what makes the
              моноблок's own on-screen keyboard appear. */}
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {value ? formatMoney(given) : "—"}
          </span>
        </div>
      </div>

      <div
        className={clsx(
          "mt-2 flex items-baseline justify-between rounded-xl px-4 py-3",
          change > 0 ? "bg-emerald-50" : "bg-surface-muted",
        )}
      >
        <span className={clsx("text-sm", change > 0 ? "text-emerald-700" : "text-muted")}>Сдача</span>
        <span
          className={clsx(
            "text-2xl font-semibold tabular-nums",
            change > 0 ? "text-emerald-700" : "text-muted",
          )}
        >
          {valid ? formatMoney(change) : "—"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {quickCashAmounts(total).map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => setValue(String(amount))}
            className="rounded-xl border border-border px-2 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
          >
            {amount === total ? "Без сдачи" : amount.toLocaleString("ru-RU")}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <NumberPad value={value} onChange={setValue} onSubmit={submit} />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!valid || isSubmitting}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        {isSubmitting ? "…" : "Провести продажу"}
      </button>
    </Modal>
  );
}

// A card settles the exact amount, so there is nothing to work out — this
// exists purely so a stray tap on «Карта» cannot complete a sale on its own,
// and so the cashier has somewhere to back out after the terminal declines.
function CardPaymentModal({
  total,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  total: number;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal title="Оплата картой" onClose={onClose} width="max-w-sm">
      <div className="rounded-xl border border-border bg-surface-muted px-4 py-5 text-center">
        <p className="text-sm text-muted">К оплате</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{formatMoney(total)}</p>
      </div>
      <p className="mt-3 text-xs text-muted">
        Проведите оплату на терминале, затем подтвердите. Продажа запишется только после подтверждения.
      </p>
      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        {isSubmitting ? "…" : "Оплата прошла — провести продажу"}
      </button>
      <button
        type="button"
        onClick={onClose}
        disabled={isSubmitting}
        className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-muted disabled:opacity-40"
      >
        Отмена
      </button>
    </Modal>
  );
}

// Part on a card, the rest in cash — a real request at the counter, and one
// that has to be recorded as two payments, because the two halves genuinely
// end up in different accounts.
//
// Only ONE number is typed: how much goes on the card. The cash part is
// whatever is left, so the two can never fail to add up to the total — the
// cashier cannot produce an unbalanced split at all. Tapping «Получено
// наличными» switches the keypad to that second number, for when the buyer
// hands over a bigger note and needs change.
function MixedPaymentModal({
  total,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  total: number;
  isSubmitting: boolean;
  onClose: () => void;
  // (card part, cash part, cash actually handed over)
  onSubmit: (card: number, cash: number, cashGiven: number) => void;
}) {
  const [field, setField] = useState<"card" | "given">("card");
  const [cardValue, setCardValue] = useState("");
  const [givenValue, setGivenValue] = useState("");

  const card = cardValue ? Number(cardValue) : 0;
  const cashPart = Math.max(0, total - card);
  // Untouched, the buyer hands over exactly the cash part and there is no
  // change — the common case needs no second number at all.
  const given = givenValue ? Number(givenValue) : cashPart;
  const change = given - cashPart;

  const valid = card > 0 && card < total && given >= cashPart && !isSubmitting;
  const submit = () => {
    if (valid) onSubmit(card, cashPart, given);
  };

  return (
    <Modal title="Картой и наличными" onClose={onClose} width="max-w-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-muted">К оплате</span>
        <span className="text-xl font-semibold text-foreground">{formatMoney(total)}</span>
      </div>

      <button
        type="button"
        onClick={() => setField("card")}
        className={clsx(
          "flex w-full items-baseline justify-between rounded-xl border px-4 py-3 text-left transition",
          field === "card" ? "border-accent bg-surface" : "border-border bg-surface-muted",
        )}
      >
        <span className="text-sm text-muted">Картой</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {cardValue ? formatMoney(card) : "—"}
        </span>
      </button>

      <div className="mt-2 flex items-baseline justify-between rounded-xl bg-surface-muted px-4 py-3">
        <span className="text-sm text-muted">Наличными</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {formatMoney(cashPart)}
        </span>
      </div>

      {cashPart > 0 && (
        <>
          <button
            type="button"
            onClick={() => setField("given")}
            className={clsx(
              "mt-2 flex w-full items-baseline justify-between rounded-xl border px-4 py-3 text-left transition",
              field === "given" ? "border-accent bg-surface" : "border-border bg-surface-muted",
            )}
          >
            <span className="text-sm text-muted">Получено наличными</span>
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {formatMoney(given)}
            </span>
          </button>
          {change > 0 && (
            <div className="mt-2 flex items-baseline justify-between rounded-xl bg-emerald-50 px-4 py-3">
              <span className="text-sm text-emerald-700">Сдача</span>
              <span className="text-2xl font-semibold tabular-nums text-emerald-700">
                {formatMoney(change)}
              </span>
            </div>
          )}
        </>
      )}

      <div className="mt-3">
        <NumberPad
          value={field === "card" ? cardValue : givenValue}
          onChange={field === "card" ? setCardValue : setGivenValue}
          onSubmit={submit}
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!valid}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        {isSubmitting ? "…" : "Провести продажу"}
      </button>
      {card >= total && cardValue !== "" && (
        <p className="mt-2 text-center text-xs text-muted">
          Вся сумма на карте — используйте кнопку «Карта»
        </p>
      )}
    </Modal>
  );
}

// The exact amount, then the next few round notes above it. Anything already
// smaller than the total is useless as a suggestion, and duplicates are
// dropped so «Без сдачи» never appears twice.
function quickCashAmounts(total: number): number[] {
  const notes = [500, 1000, 2000, 5000, 10000, 20000];
  const above = notes.filter((n) => n > total);
  const rounded = Math.ceil(total / 1000) * 1000;
  const suggestions = [total, ...(rounded > total ? [rounded] : []), ...above];
  return suggestions.filter((amount, i) => suggestions.indexOf(amount) === i).slice(0, 4);
}

// Asks for the amount of an open-price line, on the same keypad as the cash
// dialog — for the same reason: no <input>, no OS keyboard.
function OpenPriceModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (amount: number) => void;
}) {
  const [value, setValue] = useState("");
  const amount = value ? Number(value) : 0;
  const valid = amount > 0;
  const submit = () => {
    if (valid) onSubmit(amount);
  };

  return (
    <Modal title="Произвольная сумма" onClose={onClose} width="max-w-sm">
      <div className="mb-3 rounded-xl border border-border bg-surface-muted px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Сумма</span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {value ? formatMoney(amount) : "—"}
          </span>
        </div>
      </div>

      <NumberPad value={value} onChange={setValue} onSubmit={submit} />

      <p className="mt-3 text-xs text-muted">
        Для товара, которого ещё нет в номенклатуре. Склад по такой строке не списывается.
      </p>
      <button
        type="button"
        onClick={submit}
        disabled={!valid}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        Добавить в чек
      </button>
    </Modal>
  );
}

// Print-only: invisible on screen (`hidden print:block`), rendered instead of
// the interactive till when the browser's print dialog fires — a slip
// shaped like an actual receipt rather than a screenshot of the whole page
// with buttons and a sidebar in it.
function PrintableReceipt({
  sale,
  cash,
  orgName,
}: {
  sale: SaleDetailDto;
  cash: { given: number; change: number } | null;
  // The brand, not the till: a buyer's slip should say «Ar-Amir», the name
  // on the storefront, not the internal location name (which for a rented
  // corner of someone else's supermarket may not even be a shop name at
  // all — see the Мерей/Фазиза case that prompted this).
  orgName: string;
}) {
  return (
    <div className="hidden print:block print:mx-auto print:max-w-xs print:text-black">
      <p className="text-center text-sm font-semibold">{orgName}</p>
      <p className="text-center text-xs">{sale.locationName}</p>
      <p className="text-center text-xs">{new Date(sale.soldAt).toLocaleString("ru-RU")}</p>
      <div className="my-3 border-t border-dashed border-black" />
      <table className="w-full text-xs">
        <tbody>
          {sale.items.map((item) => (
            <Fragment key={item.id}>
              <tr>
                <td colSpan={2} className="pt-2">
                  {item.productName}
                </td>
              </tr>
              <tr>
                <td className="pt-0.5">
                  {formatQuantity(item.quantity)} × {formatMoney(item.unitPrice)}
                </td>
                <td className="pt-0.5 text-right">{formatMoney(item.subtotal)}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="my-3 border-t border-dashed border-black" />
      <div className="flex justify-between text-sm font-semibold">
        <span>Итого</span>
        <span>{formatMoney(sale.totalAmount)}</span>
      </div>
      {/* A split sale prints each tender; anything else prints its one
          method. Reading the label off the shared map rather than a
          CASH-or-else ternary, which printed «Карта» for a transfer and
          would now print it for a mixed sale too.
          `sale.payments ?? []`, not `sale.payments`: this block renders
          right after every sale (the print-only div is hidden by CSS, not
          by React, so it still executes), and if the API server is a build
          behind the web app — which has happened before on this project —
          `payments` would be missing from its response entirely rather than
          an empty array. That crashed the whole till after every single
          sale until this guard, on every browser, because it really was
          the deployed code faulting against a stale server reply. */}
      {(sale.payments ?? []).length > 0 ? (
        <div className="mt-1 text-xs">
          {sale.payments.map((p) => (
            <div key={p.method} className="flex justify-between">
              <span>{PAYMENT_METHOD_LABELS_RU[p.method]}</span>
              <span>{formatMoney(p.amount)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs">{PAYMENT_METHOD_LABELS_RU[sale.paymentMethod]}</p>
      )}
      {cash && cash.change > 0 && (
        <div className="mt-1 text-xs">
          <div className="flex justify-between">
            <span>Получено</span>
            <span>{formatMoney(cash.given)}</span>
          </div>
          <div className="flex justify-between">
            <span>Сдача</span>
            <span>{formatMoney(cash.change)}</span>
          </div>
        </div>
      )}
      {sale.fiscalReceipt?.ticketNumber && (
        <>
          <div className="my-3 border-t border-dashed border-black" />
          <p className="text-center text-xs">Фискальный чек № {sale.fiscalReceipt.ticketNumber}</p>
          {sale.fiscalReceipt.qrCode && (
            <div className="mt-2 flex justify-center">
              <QRCodeSVG value={sale.fiscalReceipt.qrCode} size={96} fgColor="#000000" bgColor="#ffffff" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Shown after a fiscalised sale. Stays until the cashier closes it or starts
// the next order — the buyer needs long enough to scan the QR.
function ReceiptPanel({
  amount,
  fiscal,
  onClose,
  onPrint,
}: {
  amount: number;
  fiscal: SaleFiscalReceiptDto;
  onClose: () => void;
  onPrint: () => void;
}) {
  const registered = fiscal.status === FiscalReceiptStatus.REGISTERED;

  return (
    <div className="mb-4 flex items-start gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      {fiscal.qrCode && (
        // Fixed black-on-white regardless of theme: a QR has to stay
        // high-contrast to be readable by a phone camera, so this is the one
        // place that deliberately does not follow the theme tokens.
        <div className="shrink-0 rounded-lg bg-white p-2">
          <QRCodeSVG value={fiscal.qrCode} size={104} fgColor="#000000" bgColor="#ffffff" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-emerald-800">Продажа проведена — {formatMoney(amount)}</p>
        {fiscal.ticketNumber && (
          <p className="mt-1 font-mono text-lg font-semibold tracking-tight text-emerald-900">
            Чек № {fiscal.ticketNumber}
          </p>
        )}
        {!registered && (
          <p className="mt-1 text-sm text-amber-700">
            Чек не подтверждён кассой. Проверьте раздел «Требует внимания».
          </p>
        )}
        {registered && fiscal.isOffline && (
          <p className="mt-1 text-sm text-amber-700">
            Чек пробит офлайн. Проверка по QR заработает после синхронизации кассы.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onPrint}
          aria-label="Печать чека"
          className="rounded-lg border border-emerald-200 bg-white p-1.5 text-emerald-700 transition hover:bg-emerald-50"
        >
          <Printer className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button onClick={onClose} aria-label="Закрыть чек" className="text-emerald-700">
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function QtyButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground transition hover:bg-surface-muted"
    >
      {children}
    </button>
  );
}
