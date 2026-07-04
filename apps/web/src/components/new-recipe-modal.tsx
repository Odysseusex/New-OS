"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ProductDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

interface Row {
  ingredientProductId: string;
  quantity: string;
}

export function NewRecipeModal({
  products,
  existingRecipeProductIds,
  onClose,
  onCreated,
}: {
  products: ProductDto[];
  existingRecipeProductIds: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const outputOptions = products.filter((p) => !existingRecipeProductIds.includes(p.id));
  const [productId, setProductId] = useState(outputOptions[0]?.id ?? "");
  const [yieldQuantity, setYieldQuantity] = useState("1");
  const [rows, setRows] = useState<Row[]>([{ ingredientProductId: products[0]?.id ?? "", quantity: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { ingredientProductId: products[0]?.id ?? "", quantity: "1" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.recipes.create({
        productId,
        yieldQuantity: Number(yieldQuantity),
        items: rows.map((r) => ({
          ingredientProductId: r.ingredientProductId,
          quantity: Number(r.quantity),
        })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать рецептуру");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (outputOptions.length === 0) {
    return (
      <Modal title="Новая рецептура" onClose={onClose}>
        <p className="text-sm text-muted">
          У всех товаров уже есть рецептура. Добавьте новый товар в номенклатуре на странице
          «Склад», чтобы создать для него рецептуру.
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Новая рецептура" onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit}>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Готовый товар
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {outputOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Выход с одного замеса
            </label>
            <input
              type="number"
              min="0"
              step="any"
              required
              value={yieldQuantity}
              onChange={(e) => setYieldQuantity(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <p className="mb-2 text-sm font-medium text-foreground">Ингредиенты</p>
        <div className="mb-3 space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={row.ingredientProductId}
                onChange={(e) => updateRow(index, { ingredientProductId: e.target.value })}
                className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({UNIT_LABELS_RU[p.unit]})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(e) => updateRow(index, { quantity: e.target.value })}
                className="w-24 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Кол-во"
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

        <button
          type="button"
          onClick={addRow}
          className="mb-5 flex items-center gap-1.5 text-sm font-medium text-accent hover:opacity-80"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Добавить ингредиент
        </button>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : "Создать рецептуру"}
        </button>
      </form>
    </Modal>
  );
}
