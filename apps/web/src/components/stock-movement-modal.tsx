"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LocationDto, ProductDto, StockLevelDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU, WRITE_OFF_REASON_LABELS_RU, WriteOffReason } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatQuantity } from "@/lib/format";

export function StockMovementModal({
  mode,
  locations,
  products,
  stockLevels = [],
  fixedLocationId,
  onClose,
  onCreated,
}: {
  mode: "receive" | "write-off" | "adjustment";
  locations: LocationDto[];
  products: ProductDto[];
  stockLevels?: StockLevelDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [locationId, setLocationId] = useState(fixedLocationId ?? locations[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [writeOffReason, setWriteOffReason] = useState<WriteOffReason>(WriteOffReason.OTHER);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isReceive = mode === "receive";
  const isAdjustment = mode === "adjustment";

  // locations/products can still be loading when this modal opens, so the
  // first render may have nothing to default to. Backfill once they arrive.
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(fixedLocationId ?? locations[0].id);
    }
  }, [locations, locationId, fixedLocationId]);

  useEffect(() => {
    if (!productId && products.length > 0) setProductId(products[0].id);
  }, [products, productId]);

  const effectiveLocationId = fixedLocationId ?? locationId;
  const currentLevel = isAdjustment
    ? stockLevels.find((s) => s.locationId === effectiveLocationId && s.productId === productId)
    : undefined;
  const selectedProduct = products.find((p) => p.id === productId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isAdjustment) {
        await api.inventory.adjust({
          locationId: effectiveLocationId,
          productId,
          actualQuantity: Number(quantity),
          reason,
        });
      } else {
        const dto = {
          locationId: effectiveLocationId,
          productId,
          quantity: Number(quantity),
          reason: reason || undefined,
        };
        if (isReceive) {
          await api.inventory.receive(dto);
        } else {
          await api.inventory.writeOff({ ...dto, writeOffReason });
        }
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить операцию");
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = isReceive ? "Приёмка товара" : isAdjustment ? "Корректировка остатка" : "Списание товара";

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {!fixedLocationId && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Точка</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
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
          <label className="mb-1.5 block text-sm font-medium text-foreground">Товар</label>
          <ProductSelect products={products} value={productId} onChange={setProductId} />
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {isAdjustment ? "Фактическое количество на складе" : "Количество"}
          </label>
          {isAdjustment && (
            <p className="mb-1.5 text-xs text-muted">
              По данным системы сейчас:{" "}
              {currentLevel ? `${formatQuantity(currentLevel.quantity)} ${UNIT_LABELS_RU[currentLevel.unit]}` : "0"}
              {selectedProduct && !currentLevel ? ` ${UNIT_LABELS_RU[selectedProduct.unit]}` : ""}
              . Укажите, сколько есть на самом деле — система сама посчитает разницу.
            </p>
          )}
          <input
            type="number"
            min="0"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {!isReceive && !isAdjustment && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Причина списания</label>
            <select
              value={writeOffReason}
              onChange={(e) => setWriteOffReason(e.target.value as WriteOffReason)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(WriteOffReason).map((r) => (
                <option key={r} value={r}>
                  {WRITE_OFF_REASON_LABELS_RU[r]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {isAdjustment ? "Причина корректировки" : "Комментарий"}{" "}
            {!isAdjustment && <span className="text-muted">(необязательно)</span>}
          </label>
          <input
            type="text"
            required={isAdjustment}
            minLength={isAdjustment ? 2 : undefined}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isAdjustment
                ? "Например: ошибочно приходовали не тот товар"
                : isReceive
                  ? "Поступление от поставщика"
                  : "Подробности, номер акта…"
            }
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : isReceive ? "Оприходовать" : isAdjustment ? "Сохранить корректировку" : "Списать"}
        </button>
      </form>
    </Modal>
  );
}

// Product picker with a search box. The whole catalogue is already loaded
// client-side (api.products.list returns every product, no paging), so
// filtering is a plain in-memory substring match — no request per keystroke,
// and therefore no debounce to add.
function ProductSelect({
  products,
  value,
  onChange,
}: {
  products: ProductDto[];
  value: string;
  onChange: (productId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = products.find((p) => p.id === value);
  // Matches anywhere in the name, not just the start: "шок" finds
  // «Белый шоколад», "люкс" finds «Дрожжи прессованные "Люкс"».
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? products.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
    : products;

  // Focus the search box the moment the list opens, so the user can type
  // straight away instead of clicking into it.
  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    // Escape must close only this list, not the whole form. The Modal's own
    // Escape handler listens on `document` too, and React delegates its events
    // from `document` as well, so stopping the event from inside a React
    // onKeyDown cannot reach it. Intercepting in the capture phase does: it
    // runs before every bubble-phase listener no matter the registration order.
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setIsOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [isOpen]);

  function select(productId: string) {
    onChange(productId);
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        <span className={selected ? "" : "text-muted"}>
          {selected ? `${selected.name} (${UNIT_LABELS_RU[selected.unit]})` : "Выберите товар"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // This picker sits inside the <form>, so a bare Enter would
                // submit the stock movement instead of picking a product.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length > 0) select(filtered[0].id);
                }
                // Escape is handled by the capture-phase listener above.
              }}
              placeholder="Поиск товара…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  onClick={() => select(p.id)}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-surface-muted ${
                    p.id === value ? "text-accent" : "text-foreground"
                  }`}
                >
                  {p.name} ({UNIT_LABELS_RU[p.unit]})
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-3 text-sm text-muted">Ничего не найдено</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
