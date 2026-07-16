"use client";

import { useState } from "react";
import type { CategoryDto, ProductDto } from "@bakery-os/shared";
import { PRODUCT_TYPE_LABELS_RU, ProductType, Unit, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function NewProductModal({
  categories,
  product,
  onClose,
  onSaved,
}: {
  categories: CategoryDto[];
  product?: ProductDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [unit, setUnit] = useState<Unit>(product?.unit ?? Unit.PCS);
  const [type, setType] = useState<ProductType>(product?.type ?? ProductType.FINISHED_GOOD);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const dto = { name, sku, unit, type, categoryId: categoryId || undefined, price: Number(price) };
      if (product) {
        await api.products.update(product.id, dto);
      } else {
        await api.products.create(dto);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить товар");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={product ? "Редактировать товар" : "Новый товар"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Артикул</label>
            <input
              type="text"
              required
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Единица</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(Unit).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS_RU[u]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Тип</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ProductType)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(ProductType).map((t) => (
                <option key={t} value={t}>
                  {PRODUCT_TYPE_LABELS_RU[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Категория</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Без категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {type === ProductType.RAW_MATERIAL ? "Цена закупки, ₸ за ед." : "Цена продажи, ₸"}
          </label>
          <input
            type="number"
            min="0"
            step="any"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1.5 text-xs text-muted">
            {type === ProductType.RAW_MATERIAL
              ? "Используется для автоматического расчёта себестоимости в рецептах — держите в актуальном состоянии по факту закупки"
              : "Цена, по которой товар продаётся клиенту"}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : product ? "Сохранить" : "Добавить товар"}
        </button>
      </form>
    </Modal>
  );
}
