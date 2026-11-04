"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { LocationDto, ProductDto, SupplierDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { formatMoney } from "@/lib/format";
import { enterNext, withTrailingRow } from "@/lib/keyboard";
import { SubmitShortcutHint } from "@/components/submit-shortcut-hint";

interface Row {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, productId: "", quantity: "", unitCost: "" });

export function NewPurchaseOrderModal({
  suppliers,
  locations,
  products,
  fixedLocationId,
  onClose,
  onCreated,
}: {
  suppliers: SupplierDto[];
  locations: LocationDto[];
  products: ProductDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [locationId, setLocationId] = useState(fixedLocationId ?? locations[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [docNumber, setDocNumber] = useState("");
  const [note, setNote] = useState("");

  // suppliers/locations/products can still be loading when this modal opens,
  // so the first render may have nothing to default to. Backfill once the
  // lists arrive, without touching a row the user already edited.
  useEffect(() => {
    if (!supplierId && suppliers.length > 0) setSupplierId(suppliers[0].id);
  }, [suppliers, supplierId]);

  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(fixedLocationId ?? locations[0].id);
    }
  }, [locations, locationId, fixedLocationId]);

  // A semi-finished product is never bought (the server refuses it too).
  const purchasable = products.filter((p) => p.type !== "SEMI_FINISHED");
  const total = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0), 0);

  // There is always one empty line at the end: picking a product in it adds the next.
  const trailing = (list: Row[]) => withTrailingRow(list, (r) => !r.productId, emptyRow);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => trailing(prev.map((r, i) => (i === index ? { ...r, ...patch } : r))));
  }

  function pickProduct(index: number, productId: string) {
    // The last purchase price on the card, to change when it costs more or less now.
    const product = products.find((p) => p.id === productId);
    updateRow(index, { productId, unitCost: product ? String(product.price) : "" });
  }

  function removeRow(index: number) {
    setRows((prev) => trailing(prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const lines = rows.filter((r) => r.productId);
    if (lines.length === 0) {
      setError("Добавьте хотя бы один товар");
      return;
    }
    if (lines.some((r) => r.quantity.trim() === "" || !(Number(r.quantity) > 0))) {
      setError("Укажите количество в каждой строке");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.procurement.createOrder({
        supplierId,
        locationId: fixedLocationId ?? locationId,
        supplierDocNumber: docNumber.trim() || undefined,
        note: note.trim() || undefined,
        items: lines.map((r) => ({
          productId: r.productId,
          quantity: Number(r.quantity),
          unitCost: Number(r.unitCost),
        })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать заказ");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (suppliers.length === 0) {
    return (
      <Modal title="Новый заказ поставщику" onClose={onClose}>
        <p className="text-sm text-muted">
          Сначала добавьте поставщика на вкладке «Поставщики».
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Новый заказ поставщику" onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit}>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Поставщик</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {!fixedLocationId && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Точка доставки
              </label>
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
        </div>

        <div className="mb-5 space-y-2">
          {rows.map((row, index) => (
            <div key={row.key} className="flex items-center gap-2">
              <ProductSelect
                products={purchasable}
                value={row.productId}
                onChange={(productId) => pickProduct(index, productId)}
                className="min-w-0 flex-1"
                enterFlow
              />
              <input
                {...enterNext}
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(e) => updateRow(index, { quantity: e.target.value })}
                className="w-20 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Кол-во"
              />
              <input
                {...enterNext}
                type="number"
                min="0"
                step="any"
                value={row.unitCost}
                onChange={(e) => updateRow(index, { unitCost: e.target.value })}
                className="w-28 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Цена"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">
              № документа поставщика <span className="text-muted">(необязательно)</span>
            </span>
            <input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">
              Комментарий <span className="text-muted">(необязательно)</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
        </div>

        <div className="mb-5 flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
          <span className="text-sm text-muted">Итого</span>
          <span className="text-base font-semibold text-foreground">{formatMoney(total)}</span>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Создание…" : "Создать заказ"}
          {!isSubmitting && <SubmitShortcutHint />}
        </button>
      </form>
    </Modal>
  );
}
