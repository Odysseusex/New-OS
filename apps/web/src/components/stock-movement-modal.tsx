"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { LocationDto, ProductDto, StockLevelDto } from "@bakery-os/shared";
import { STOCK_BATCH_MAX_LINES, UNIT_LABELS_RU, WRITE_OFF_REASON_LABELS_RU, WriteOffReason } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { formatQuantity } from "@/lib/format";

interface Row {
  key: number;
  productId: string;
  quantity: string;
}

let nextKey = 1;
const newRow = (productId = ""): Row => ({ key: nextKey++, productId, quantity: "" });

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
    const lines = filled.map((row) => ({ productId: row.productId, quantity: Number(row.quantity.replace(",", ".")) }));
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity < 0 || (!isAdjustment && l.quantity <= 0))) {
      setError(isAdjustment ? "Укажите количество в каждой строке" : "Количество должно быть больше нуля в каждой строке");
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
          <span className="w-8" />
        </div>
        <div className="mb-3 space-y-2">
          {rows.map((row) => {
            const product = products.find((p) => p.id === row.productId);
            const level = row.productId ? levelOf(row.productId) : undefined;
            return (
              <div key={row.key}>
                <div className="flex items-center gap-2">
                  <ProductSelect
                    products={products}
                    value={row.productId}
                    onChange={(productId) => updateRow(row.key, { productId })}
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
                  <button
                    type="button"
                    onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : [newRow()]))}
                    title="Убрать строку"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
                {product && (isAdjustment || !isReceive) && (
                  <p className="mt-1 text-xs text-muted">
                    По системе сейчас: {level ? formatQuantity(level.quantity) : "0"} {UNIT_LABELS_RU[product.unit]}
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
