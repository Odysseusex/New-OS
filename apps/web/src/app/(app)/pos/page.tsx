"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Banknote, CreditCard, Minus, Plus, ScanLine, Trash2, X } from "lucide-react";
import type { CategoryDto, LocationDto, ProductDto } from "@bakery-os/shared";
import { ORG_WIDE_ROLES, PaymentMethod, ProductType, SALE_CREATE_ROLES, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney, formatQuantity } from "@/lib/format";

interface CartLine {
  product: ProductDto;
  quantity: number;
}

// Payment buttons at the till. Deliberately no "в долг" option: a walk-in
// sale is settled on the spot, and a credit sale belongs to a named customer,
// which is what the Продажи form is for.
const PAYMENT_BUTTONS: { method: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { method: PaymentMethod.CASH, label: "Наличные", icon: Banknote },
  { method: PaymentMethod.CARD, label: "Карта", icon: CreditCard },
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

  const scanRef = useRef<HTMLInputElement>(null);

  // The scan box must own the keyboard: a USB scanner is just a keyboard that
  // types very fast and presses Enter, so whatever is focused receives the
  // barcode. Pulling focus back after every tap keeps a scan working even
  // once the cashier has been clicking tiles.
  const focusScan = useCallback(() => scanRef.current?.focus(), []);

  useEffect(() => {
    // A sale moves finished goods; raw materials are never rung up at a till.
    api.products
      .list()
      .then((all) => setProducts(all.filter((p) => p.isActive && p.type === ProductType.FINISHED_GOOD)))
      .catch(() => setError("Не удалось загрузить товары"));
    api.categories.list().then(setCategories).catch(() => {});
    api.locations.list().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    if (locationId) return;
    if (!isOrgWide && user?.locationId) {
      setLocationId(user.locationId);
    } else if (locations.length > 0) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId, isOrgWide, user]);

  useEffect(focusScan, [focusScan]);

  // Typing anywhere on the page (including a scan arriving while focus sits on
  // a tile) is redirected into the scan box, so nothing is ever swallowed.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) focusScan();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusScan]);

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

  const total = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  function addToCart(product: ProductDto, step = 1) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (!existing) return [...current, { product, quantity: step }];
      return current.map((line) =>
        line.product.id === product.id ? { ...line, quantity: line.quantity + step } : line,
      );
    });
    setError(null);
  }

  function setLineQuantity(productId: string, quantity: number) {
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) => (line.product.id === productId ? { ...line, quantity } : line)),
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

  async function handlePay(method: PaymentMethod) {
    if (cart.length === 0 || !locationId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.sales.create({
        locationId,
        paymentMethod: method,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.product.price,
        })),
      });
      setFlash(`Продажа проведена — ${formatMoney(total)}`);
      setCart([]);
      setQuery("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести продажу");
    } finally {
      setIsSubmitting(false);
      focusScan();
    }
  }

  // Clears itself so the next sale starts on a clean screen without the
  // cashier having to dismiss anything.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  if (user && !canSell) {
    return <p className="mx-auto max-w-6xl text-sm text-muted">У вас нет прав на оформление продаж.</p>;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Касса</h1>
          <p className="mt-1 text-sm text-muted">Продажа на точке: сканирование, корзина, оплата</p>
        </div>
        {isOrgWide && (
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
        )}
      </div>

      {flash && (
        <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{flash}</div>
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
                <span className="text-sm font-semibold text-accent">{formatMoney(p.price)}</span>
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
                <div key={line.product.id} className="border-b border-border px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{line.product.name}</span>
                    <button
                      onClick={() => setLineQuantity(line.product.id, 0)}
                      aria-label={`Убрать ${line.product.name}`}
                      className="shrink-0 text-muted transition hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <QtyButton
                        onClick={() => setLineQuantity(line.product.id, line.quantity - 1)}
                        label={`Меньше ${line.product.name}`}
                      >
                        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
                      </QtyButton>
                      <span className="min-w-[3rem] text-center text-sm font-medium text-foreground">
                        {formatQuantity(line.quantity)} {UNIT_LABELS_RU[line.product.unit]}
                      </span>
                      <QtyButton
                        onClick={() => setLineQuantity(line.product.id, line.quantity + 1)}
                        label={`Больше ${line.product.name}`}
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      </QtyButton>
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {formatMoney(line.product.price * line.quantity)}
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
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_BUTTONS.map(({ method, label, icon: Icon }) => (
                <button
                  key={method}
                  onClick={() => handlePay(method)}
                  disabled={cart.length === 0 || isSubmitting || !locationId}
                  className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
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
