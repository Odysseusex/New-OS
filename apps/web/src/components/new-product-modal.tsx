"use client";

import { useEffect, useState } from "react";
import type { CategoryDto, ProductDto, SupplierDto } from "@bakery-os/shared";
import { PRODUCT_TYPE_LABELS_RU, ProductType, Unit, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function NewProductModal({
  categories,
  product,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  categories: CategoryDto[];
  product?: ProductDto;
  defaultCategoryId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [ntin, setNtin] = useState(product?.ntin ?? "");
  const [unit, setUnit] = useState<Unit>(product?.unit ?? Unit.PCS);
  const [type, setType] = useState<ProductType>(product?.type ?? ProductType.FINISHED_GOOD);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? defaultCategoryId ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? true);
  const [minQuantity, setMinQuantity] = useState(String(product?.minQuantity ?? 0));
  // Goods taken under consignment — somebody else's stock on our shelf that
  // we owe them for once it sells. Off by default: almost everything here is
  // our own.
  const [isConsignment, setIsConsignment] = useState(Boolean(product?.consignmentSupplierId));
  const [consignmentSupplierId, setConsignmentSupplierId] = useState(product?.consignmentSupplierId ?? "");
  const [consignmentPrice, setConsignmentPrice] = useState(
    product?.consignmentPrice !== null && product?.consignmentPrice !== undefined
      ? String(product.consignmentPrice)
      : "",
  );
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only fetched when the switch is on: an ordinary product form has no
  // business loading the supplier list.
  useEffect(() => {
    if (!isConsignment || suppliers.length > 0) return;
    api.suppliers.list().then(setSuppliers).catch(() => {});
  }, [isConsignment, suppliers.length]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const dto = {
        name,
        sku: sku.trim() || undefined,
        unit,
        type,
        categoryId: categoryId || undefined,
        price: Number(price),
        trackInventory,
        minQuantity: Number(minQuantity),
        // Null, not undefined, so switching a product back to our own goods
        // actually clears the link rather than leaving the old one in place.
        consignmentSupplierId: isConsignment ? consignmentSupplierId : null,
        consignmentPrice: isConsignment ? Number(consignmentPrice) : null,
      };
      const trimmedBarcode = barcode.trim();
      const trimmedNtin = ntin.trim();
      let saved: ProductDto;
      if (product) {
        // Explicit null, not undefined, so clearing the field actually erases
        // the stored barcode instead of leaving the old value untouched.
        saved = await api.products.update(product.id, {
          ...dto,
          barcode: trimmedBarcode || null,
          ntin: trimmedNtin || null,
        });
      } else {
        saved = await api.products.create({
          ...dto,
          barcode: trimmedBarcode || undefined,
          ntin: trimmedNtin || undefined,
        });
      }
      // The API strips fields it doesn't know about (whitelisting validation)
      // and still answers 200, so a server running an older build saves the
      // product *without* the consignment link and nothing looks wrong until
      // the form is reopened and the checkbox is blank again. Check what came
      // back instead of trusting the status code.
      if (isConsignment && !saved.consignmentSupplierId) {
        setError(
          "Товар сохранён, но признак «под реализацию» не записался — сервер работает на старой версии. Сообщите об этом и повторите после обновления.",
        );
        return;
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
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Сгенерируется автоматически"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {!product && (
              <p className="mt-1.5 text-xs text-muted">Оставьте пустым — система присвоит уникальный номер</p>
            )}
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Штрихкод <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Отсканируйте или введите вручную"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Код NTIN <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="text"
              value={ntin}
              onChange={(e) => setNtin(e.target.value)}
              placeholder="17 знаков из Национального каталога товаров"
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

        {type === ProductType.FINISHED_GOOD && (
          <div className="mb-5">
            <label className="flex items-start gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isConsignment}
                onChange={(e) => setIsConsignment(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent/20"
              />
              <span>
                <span className="font-medium">Товар под реализацию</span>
                <p className="mt-0.5 text-xs text-muted">
                  Товар чужой: платим поставщику за каждую проданную единицу, а не за привезённую.
                  Долг система считает сама по продажам — вручную ничего сводить не нужно
                </p>
              </span>
            </label>

            {isConsignment && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Поставщик</label>
                  <select
                    value={consignmentSupplierId}
                    onChange={(e) => setConsignmentSupplierId(e.target.value)}
                    required
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="">Выберите поставщика</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    Цена поставщику, ₸
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={consignmentPrice}
                    onChange={(e) => setConsignmentPrice(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <p className="mt-1.5 text-xs text-muted">
                    Сколько отдаём с одной проданной единицы. Разница с ценой продажи — ваш заработок
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mb-5">
          <label className="flex items-start gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={trackInventory}
              onChange={(e) => setTrackInventory(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent/20"
            />
            <span>
              <span className="font-medium">Контролировать складской остаток</span>
              <p className="mt-0.5 text-xs text-muted">
                Выключите для ресурсов без физического прихода (например, вода из водопровода) — товар
                останется доступен в рецептах и расчёте себестоимости, но исчезнет из остатков склада,
                приёмки, списания и предупреждений о низком остатке
              </p>
            </span>
          </label>
        </div>

        {trackInventory && (
          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Минимальный остаток</label>
            <input
              type="number"
              min="0"
              step="any"
              value={minQuantity}
              onChange={(e) => setMinQuantity(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <p className="mt-1.5 text-xs text-muted">
              Уведомление «Низкий остаток» появится, когда фактический остаток станет меньше или равен
              этому числу. Оставьте 0, если контроль не нужен — для готовой продукции это часто и есть
              правильный выбор; для сырья обычно стоит указать реальный минимум, чтобы система заранее
              предупреждала о закупке.
            </p>
          </div>
        )}

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
