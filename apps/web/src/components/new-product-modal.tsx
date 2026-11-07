"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { CategoryDto, LocationDto, ProductDto, SupplierDto } from "@bakery-os/shared";
import { LocationType } from "@bakery-os/shared";
import { PRODUCT_TYPE_LABELS_RU, PRODUCT_TYPE_ORDER, ProductType, Unit, UNIT_LABELS_RU, categoryAcceptsType } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { productPhotoUrl, resizeProductPhoto } from "@/lib/product-photo";
import { Modal } from "@/components/modal";
import { formatMoneyPrecise } from "@/lib/format";

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
  // Type → Category → Subcategory. The product itself is filed under the
  // subcategory when one is chosen, otherwise under the category.
  const initialCategory = categories.find((c) => c.id === (product?.categoryId ?? defaultCategoryId));
  // A product started from inside a category begins with that category's type.
  const [type, setType] = useState<ProductType>(product?.type ?? initialCategory?.type ?? ProductType.FINISHED_GOOD);
  const [parentCategoryId, setParentCategoryId] = useState(initialCategory?.parentId ?? initialCategory?.id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(initialCategory?.parentId ? initialCategory.id : "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? true);
  const isSemiFinished = type === ProductType.SEMI_FINISHED;
  const [isPosQuickItem, setIsPosQuickItem] = useState(product?.isPosQuickItem ?? false);
  // Photo for the till tile: a new picture to upload (data URL), or «remove».
  const [newPhoto, setNewPhoto] = useState<string | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const currentPhoto = newPhoto ?? (photoRemoved || !product ? null : productPhotoUrl(product));
  const [minQuantity, setMinQuantity] = useState(String(product?.minQuantity ?? 0));
  // Goods taken under consignment — somebody else's stock on our shelf that
  // we owe them for once it sells. Off by default: almost everything here is
  // our own.
  const [isConsignment, setIsConsignment] = useState(Boolean(product?.consignmentSupplierId));
  const [consignmentSupplierId, setConsignmentSupplierId] = useState(product?.consignmentSupplierId ?? "");
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  // The one point of sale somebody else's goods may stand on ("" = any point).
  const [consignmentLocationId, setConsignmentLocationId] = useState(product?.consignmentLocationId ?? "");
  const [stores, setStores] = useState<LocationDto[]>([]);
  useEffect(() => {
    api.locations
      .list()
      .then((all) => setStores(all.filter((l) => l.type === LocationType.STORE && (l.isActive || l.id === product?.consignmentLocationId))))
      .catch(() => setStores([]));
  }, [product?.consignmentLocationId]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only categories of the chosen type (and old ones with no type yet) are
  // offered, so a product can never be filed under another type's category. The
  // product's current category stays selectable even if it has since been archived.
  const topCategories = categories.filter(
    (c) => !c.parentId && categoryAcceptsType(c.type, type) && (c.isActive || c.id === parentCategoryId),
  );
  const subcategories = categories.filter(
    (c) => c.parentId === parentCategoryId && (c.isActive || c.id === subcategoryId),
  );

  function handleTypeChange(next: ProductType) {
    setType(next);
    if (next === ProductType.SEMI_FINISHED) setTrackInventory(false);
    const parent = categories.find((c) => c.id === parentCategoryId);
    if (parent && !categoryAcceptsType(parent.type, next)) {
      setParentCategoryId("");
      setSubcategoryId("");
    }
  }

  function handleCategoryChange(id: string) {
    setParentCategoryId(id);
    setSubcategoryId("");
  }

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
        categoryId: subcategoryId || parentCategoryId || undefined,
        price: type === ProductType.SEMI_FINISHED ? Number(price) || 0 : Number(price),
        trackInventory,
        isPosQuickItem,
        minQuantity: Number(minQuantity),
        // Null, not undefined, so switching a product back to our own goods
        // actually clears the link rather than leaving the old one in place.
        consignmentSupplierId: isConsignment ? consignmentSupplierId : null,
        consignmentPrice: null,
        consignmentLocationId: isConsignment ? consignmentLocationId || null : null,
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
      // The photo goes separately, after the product exists.
      if (newPhoto) await api.products.setPhoto(saved.id, newPhoto);
      else if (photoRemoved && product?.photoVersion) await api.products.removePhoto(saved.id);
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

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Тип</label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as ProductType)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {PRODUCT_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS_RU[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Категория</label>
            <select
              value={parentCategoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Без категории</option>
              {topCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Подкатегория</label>
            <select
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              disabled={subcategories.length === 0}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
            >
              <option value="">Без подкатегории</option>
              {subcategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {type === ProductType.FINISHED_GOOD
              ? "Цена продажи, ₸"
              : type === ProductType.SEMI_FINISHED
                ? "Цена, ₸ (не используется)"
                : "Цена закупки, ₸ за ед."}
          </label>
          <input
            type="number"
            min="0"
            step="any"
            required={type !== ProductType.SEMI_FINISHED}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1.5 text-xs text-muted">
            {type === ProductType.RAW_MATERIAL
              ? product?.type === ProductType.RAW_MATERIAL && product.averageUnitCost !== null
                ? `Последняя закупочная цена. Средневзвешенная себестоимость: ${formatMoneyPrecise(product.averageUnitCost)}`
                : "Себестоимость в техкартах считается по этой цене до первой приёмки с ценой"
              : type === ProductType.PACKAGING
                ? "Справочная цена — себестоимость упаковки берётся из фактических закупок"
                : type === ProductType.SEMI_FINISHED
                  ? "Себестоимость полуфабриката считается по его техкарте"
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
                  Товар чужой: вся выручка с него принадлежит поставщику и в отчёты о выручке и
                  прибыли не входит
                </p>
              </span>
            </label>

            {isConsignment && (
              <div className="mt-3 grid gap-3">
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
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Точка продажи</label>
                  <select
                    value={consignmentLocationId}
                    onChange={(e) => setConsignmentLocationId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="">Все точки</option>
                    {stores.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  {consignmentLocationId && (
                    <p className="mt-1 text-xs text-muted">На других точках товар не продаётся и не принимается на остаток</p>
                  )}
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
                {isSemiFinished
                  ? "Включено: полуфабрикат готовится отдельным заданием, хранится на складе и списывается со склада. Выключено: он раскладывается в сырьё при производстве изделия"
                  : "Выключите для ресурсов без физического прихода (например, вода из водопровода) — товар останется доступен в рецептах и расчёте себестоимости, но исчезнет из остатков склада, приёмки, списания и предупреждений о низком остатке"}
              </p>
            </span>
          </label>
        </div>

        {type === ProductType.FINISHED_GOOD && (
          <div className="mb-5">
            <p className="mb-1.5 text-sm font-medium text-foreground">Фото для кассы</p>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-muted">
                {currentPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentPhoto} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted" strokeWidth={1.5} />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted">
                  {currentPhoto ? "Заменить" : "Загрузить фото"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setPhotoError(null);
                      try {
                        setNewPhoto(await resizeProductPhoto(file));
                        setPhotoRemoved(false);
                      } catch (err) {
                        setPhotoError(err instanceof Error ? err.message : "Не удалось открыть картинку");
                      }
                    }}
                  />
                </label>
                {currentPhoto && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewPhoto(null);
                      setPhotoRemoved(true);
                    }}
                    className="rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    Убрать
                  </button>
                )}
              </div>
            </div>
            {photoError && <p className="mt-1.5 text-xs text-red-600">{photoError}</p>}
          </div>
        )}

        <div className="mb-5">
          <label className="flex items-start gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isPosQuickItem}
              onChange={(e) => setIsPosQuickItem(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent/20"
            />
            <span>
              <span className="font-medium">Быстрая кнопка на кассе</span>
              <p className="mt-0.5 text-xs text-muted">
                Товар появится отдельной кнопкой на экране кассы — всегда на виду, независимо от
                выбранной категории или поиска. Для мелочи, которую кассир добавляет в чек одним тапом
                (например, пакет)
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
