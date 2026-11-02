"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { LocationDto, ProductDto, StockLevelDto } from "@bakery-os/shared";
import {
  PRICE_DEVIATION_WARNING,
  ProductType,
  rawMaterialUnitCost,
  STOCK_BATCH_MAX_LINES,
  UNIT_LABELS_RU,
  WRITE_OFF_REASON_LABELS_RU,
  WriteOffReason,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { formatMoney, formatMoneyPrecise, formatQuantity } from "@/lib/format";

interface Row {
  key: number;
  productId: string;
  quantity: string;
  // Receipts of raw materials: what one unit cost (prefilled with the last price).
  price: string;
}

// What the product card's price means depends on the type: a finished good's is
// what it sells for, raw material's and packaging's is what it is bought for. The
// two are never added together. Shown for checking only — except a receipt's
// price of a raw material, which is saved and moves its weighted average.
type PriceKind = "SALE" | "PURCHASE";
const priceKindOf = (product: ProductDto): PriceKind | null =>
  product.type === ProductType.FINISHED_GOOD
    ? "SALE"
    : product.type === ProductType.RAW_MATERIAL || product.type === ProductType.PACKAGING
      ? "PURCHASE"
      : null;
const PRICE_LABEL: Record<PriceKind, string> = { SALE: "Цена продажи", PURCHASE: "Закупочная цена" };
const TOTAL_LABEL: Record<PriceKind, string> = { SALE: "по цене продажи", PURCHASE: "по закупочной цене" };
const signedMoney = (v: number) => (v > 0 ? `+${formatMoney(v)}` : formatMoney(v || 0));
const signedQuantity = (v: number) => (v > 0 ? `+${formatQuantity(v)}` : formatQuantity(v));

let nextKey = 1;
const newRow = (productId = ""): Row => ({ key: nextKey++, productId, quantity: "", price: "" });
const isRaw = (product: ProductDto | undefined) => product?.type === ProductType.RAW_MATERIAL;
// A raw material is valued at its weighted average, everything else at its card price.
const valueOf = (product: ProductDto) => (isRaw(product) ? rawMaterialUnitCost(product.price, product.averageUnitCost) : product.price);
const parseNumber = (text: string) => Number(text.replace(",", "."));

// Receipt / write-off / correction of several products in ONE document: the
// point, the reason and the comment are shared, and the server writes every line
// or none of them (one line short of stock stops the whole document, by name).
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
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [writeOffReason, setWriteOffReason] = useState<WriteOffReason>(WriteOffReason.OTHER);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isReceive = mode === "receive";
  const isAdjustment = mode === "adjustment";

  // locations can still be loading when this modal opens, so the first render
  // may have nothing to default to. Backfill once they arrive.
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(fixedLocationId ?? locations[0].id);
    }
  }, [locations, locationId, fixedLocationId]);

  const effectiveLocationId = fixedLocationId ?? locationId;
  const levelOf = (productId: string) => stockLevels.find((s) => s.locationId === effectiveLocationId && s.productId === productId);

  const chosen = rows.filter((r) => r.productId);
  const duplicateIds = new Set(chosen.map((r) => r.productId).filter((id, i, all) => all.indexOf(id) !== i));

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const filled = rows.filter((r) => r.productId || r.quantity.trim() !== "");
    if (filled.length === 0) {
      setError("Добавьте хотя бы один товар");
      return;
    }
    if (filled.some((r) => !r.productId)) {
      setError("В одной из строк не выбран товар");
      return;
    }
    if (duplicateIds.size > 0) {
      setError("Один и тот же товар указан дважды — объедините строки");
      return;
    }
    // An empty quantity is never read as 0 — for a correction that would empty the shelf.
    if (filled.some((row) => row.quantity.trim() === "")) {
      setError("Укажите количество в каждой строке");
      return;
    }
    const productOf = (id: string) => products.find((p) => p.id === id);
    const lines = filled.map((row) => ({
      productId: row.productId,
      quantity: parseNumber(row.quantity),
      ...(isReceive && isRaw(productOf(row.productId)) ? { unitPrice: parseNumber(row.price) } : {}),
    }));
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity < 0 || (!isAdjustment && l.quantity <= 0))) {
      setError(isAdjustment ? "Укажите количество в каждой строке" : "Количество должно быть больше нуля в каждой строке");
      return;
    }
    const unpriced = lines.filter((l) => l.unitPrice !== undefined && !(Number.isFinite(l.unitPrice) && l.unitPrice > 0));
    if (unpriced.length > 0) {
      setError(`Укажите цену за единицу: ${unpriced.map((l) => productOf(l.productId)?.name).join(", ")}`);
      return;
    }
    // A slipped digit would move the average for months: ask before saving it.
    const unusual = lines.filter((l) => {
      const product = productOf(l.productId);
      if (l.unitPrice === undefined || !product) return false;
      const average = valueOf(product);
      return average > 0 && Math.abs(l.unitPrice - average) / average > PRICE_DEVIATION_WARNING;
    });
    if (
      unusual.length > 0 &&
      !confirm(
        `Цена сильно отличается от средней:\n${unusual
          .map((l) => `${productOf(l.productId)?.name}: ${formatMoneyPrecise(l.unitPrice!)} (средняя ${formatMoneyPrecise(valueOf(productOf(l.productId)!))})`)
          .join("\n")}\n\nВсё верно?`,
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await api.inventory.batch(isReceive ? "receipts" : isAdjustment ? "adjustments" : "write-offs", {
        locationId: effectiveLocationId,
        reason: reason.trim() || undefined,
        writeOffReason: !isReceive && !isAdjustment ? writeOffReason : undefined,
        lines,
      });
      if (result.unchanged.length > 0) {
        // Shown on the stock screen's refresh would be lost; tell it here, then close.
        setNotice(`Без изменений (остаток уже совпадал): ${result.unchanged.join(", ")}`);
        setTimeout(onCreated, 2500);
        return;
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить операцию");
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = isReceive ? "Приёмка товара" : isAdjustment ? "Корректировка остатка" : "Списание товара";
  const count = chosen.length;

  // Per line: the quantity this document moves (for a correction, the difference
  // from what the system holds), and its value at the card's price.
  const lineFigures = (row: Row) => {
    const product = products.find((p) => p.id === row.productId);
    const typed = parseNumber(row.quantity);
    if (!product || row.quantity.trim() === "" || !Number.isFinite(typed)) return null;
    const moved = isAdjustment ? Math.round((typed - (levelOf(product.id)?.quantity ?? 0)) * 1000) / 1000 : typed;
    const kind = priceKindOf(product);
    // A raw material received at a typed price is worth that price.
    const typedPrice = isReceive && isRaw(product) && row.price.trim() !== "" ? parseNumber(row.price) : null;
    const unit = typedPrice !== null && Number.isFinite(typedPrice) ? typedPrice : valueOf(product);
    return { moved, kind, value: kind ? Math.round(moved * unit * 100) / 100 : null };
  };
  const totals = new Map<PriceKind, number>();
  for (const row of rows) {
    const f = lineFigures(row);
    if (f?.kind && f.value !== null) totals.set(f.kind, (totals.get(f.kind) ?? 0) + f.value);
  }
  const action = isReceive ? "Оприходовать" : isAdjustment ? "Сохранить корректировку" : "Списать";

  return (
    <Modal title={title} onClose={onClose} width="max-w-2xl">
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

        <div className="mb-2 flex items-end gap-2 text-sm font-medium text-foreground">
          <span className="flex-1">Товар</span>
          <span className="w-32">{isAdjustment ? "Фактически" : "Количество"}</span>
          {isReceive && <span className="w-32">Цена за ед.</span>}
          <span className="w-8" />
        </div>
        <div className="mb-3 space-y-2">
          {rows.map((row) => {
            const product = products.find((p) => p.id === row.productId);
            const level = row.productId ? levelOf(row.productId) : undefined;
            const figures = lineFigures(row);
            return (
              <div key={row.key}>
                <div className="flex items-center gap-2">
                  <ProductSelect
                    products={products}
                    value={row.productId}
                    onChange={(productId) => {
                      const picked = products.find((p) => p.id === productId);
                      // The last purchase price, to change when it was bought for more or less.
                      updateRow(row.key, { productId, price: isReceive && isRaw(picked) ? String(picked!.price) : "" });
                    }}
                    className="min-w-0 flex-1"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    placeholder={product ? UNIT_LABELS_RU[product.unit] : ""}
                    className="w-32 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  {isReceive &&
                    (isRaw(product) ? (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={row.price}
                        onChange={(e) => updateRow(row.key, { price: e.target.value })}
                        placeholder="₸"
                        aria-label="Цена за единицу"
                        className="w-32 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      />
                    ) : (
                      <span className="w-32" />
                    ))}
                  <button
                    type="button"
                    onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : [newRow()]))}
                    title="Убрать строку"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
                {product && (
                  <p className="mt-1 text-xs text-muted">
                    {[
                      !isReceive ? `По системе сейчас: ${level ? formatQuantity(level.quantity) : "0"} ${UNIT_LABELS_RU[product.unit]}` : null,
                      isAdjustment && figures ? `Разница: ${signedQuantity(figures.moved)} ${UNIT_LABELS_RU[product.unit]}` : null,
                      isRaw(product)
                        ? `Средневзвешенная себестоимость: ${formatMoneyPrecise(valueOf(product))}`
                        : priceKindOf(product)
                          ? `${PRICE_LABEL[priceKindOf(product)!]}: ${formatMoney(product.price)}`
                          : null,
                      figures?.value !== null && figures?.value !== undefined
                        ? `${isAdjustment ? "" : "Сумма: "}${isAdjustment ? signedMoney(figures.value) : formatMoney(figures.value)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {row.productId && duplicateIds.has(row.productId) && <p className="mt-1 text-xs text-red-600">Этот товар уже есть в списке</p>}
              </div>
            );
          })}
        </div>
        {rows.length < STOCK_BATCH_MAX_LINES && (
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, newRow()])}
            className="mb-5 flex items-center gap-1.5 text-sm font-medium text-accent hover:opacity-80"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Добавить товар
          </button>
        )}

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
              isAdjustment ? "Например: ошибочно приходовали не тот товар" : isReceive ? "Поступление от поставщика" : "Подробности, номер акта…"
            }
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {totals.size > 0 && (
          <div className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm">
            {(["SALE", "PURCHASE"] as PriceKind[])
              .filter((kind) => totals.has(kind))
              .map((kind) => (
                <div key={kind} className="flex items-center justify-between py-0.5">
                  <span className="text-muted">
                    {isAdjustment ? "Разница" : "Итого"} {TOTAL_LABEL[kind]}
                  </span>
                  <span className="font-semibold text-foreground">
                    {isAdjustment ? signedMoney(totals.get(kind)!) : formatMoney(totals.get(kind)!)}
                  </span>
                </div>
              ))}
          </div>
        )}

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{notice}</div>}

        <button
          type="submit"
          disabled={isSubmitting || !!notice}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : count > 1 ? `${action} (${count})` : action}
        </button>
      </form>
    </Modal>
  );
}
