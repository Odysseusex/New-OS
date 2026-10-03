"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowDownCircle, ArrowLeft, ArrowUpCircle, Ban, Plus, Search, Wrench, X } from "lucide-react";
import type { CategoryDto, CategoryTypeGroup, LocationDto, ProductDto, StockLevelDto, StockMovementDto } from "@bakery-os/shared";
import {
  HARD_DELETE_ROLES,
  STOCK_VOID_ROLES,
  INVENTORY_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  PRODUCT_FORCE_DELETE_ROLES,
  PRODUCT_MANAGE_ROLES,
  PRODUCT_TYPE_LABELS_RU,
  PRODUCT_TYPE_ORDER,
  ProductType,
  buildCategoryTree,
  categoryIdsWithDescendants,
  categoryPathLabel,
  STOCK_MOVEMENT_TYPE_LABELS_RU,
  StockMovementType,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { StockMovementModal } from "@/components/stock-movement-modal";
import { LabelPrintModal } from "@/components/label-print-modal";
import { NewProductModal } from "@/components/new-product-modal";
import { CategoryModal } from "@/components/category-modal";
import { StandardCatalogModal } from "@/components/standard-catalog-modal";
import { ClassificationModal } from "@/components/classification-modal";
import { ForceDeleteProductModal } from "@/components/force-delete-product-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";
import { LocationPricesTab } from "@/components/location-prices-tab";
import { StocktakeTab } from "@/components/stocktake-tab";
import { StockVoidModal } from "@/components/stock-void-modal";

type Tab = "stock" | "catalog" | "categories" | "prices" | "stocktake";

export default function InventoryPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const canManageInventory = user ? INVENTORY_MANAGE_ROLES.includes(user.role) : false;
  const canManageProducts = user ? PRODUCT_MANAGE_ROLES.includes(user.role) : false;
  const canDelete = user ? HARD_DELETE_ROLES.includes(user.role) : false;
  const canVoidStock = user ? STOCK_VOID_ROLES.includes(user.role) : false;
  const canForceDelete = user ? PRODUCT_FORCE_DELETE_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("stock");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevelDto[]>([]);
  const [movements, setMovements] = useState<StockMovementDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [showArchivedProducts, setShowArchivedProducts] = useState(false);
  const [showArchivedCategories, setShowArchivedCategories] = useState(false);
  const [modal, setModal] = useState<"receive" | "write-off" | "adjustment" | "product" | "category" | "void" | "standard-catalog" | "classification" | null>(
    null,
  );
  const [forceDeleteProduct, setForceDeleteProduct] = useState<ProductDto | undefined>(undefined);
  const [editingProduct, setEditingProduct] = useState<ProductDto | undefined>(undefined);
  const [labelProduct, setLabelProduct] = useState<ProductDto | undefined>(undefined);
  const [editingCategory, setEditingCategory] = useState<CategoryDto | undefined>(undefined);
  // Where a new category starts: under a type's own «Добавить», or under a category as its subcategory.
  const [newCategoryType, setNewCategoryType] = useState<ProductType | undefined>(undefined);
  const [newCategoryParentId, setNewCategoryParentId] = useState<string | undefined>(undefined);
  const [newProductCategoryId, setNewProductCategoryId] = useState<string | undefined>(undefined);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  // The category list is replaced by the category's own page and comes back
  // freshly mounted, i.e. scrolled to the top. Remember where it was.
  const listScrollTop = useRef<number | null>(null);
  const openCategory = (id: string) => {
    listScrollTop.current = document.querySelector("main")?.scrollTop ?? 0;
    setSelectedCategoryId(id);
  };
  useLayoutEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    if (selectedCategoryId) {
      main.scrollTop = 0;
    } else if (listScrollTop.current !== null) {
      main.scrollTop = listScrollTop.current;
      listScrollTop.current = null;
    }
  }, [selectedCategoryId]);
  const [productSearch, setProductSearch] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Matches anywhere in the name or the SKU, not just from the start, so
  // "шок" finds «Белый шоколад». Filtering is local — the catalogue is already
  // fully loaded — so there's no request per keystroke and no debounce needed.
  const productQuery = productSearch.trim().toLowerCase();
  const visibleProducts = productQuery
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(productQuery) ||
          (p.sku ?? "").toLowerCase().includes(productQuery) ||
          (p.barcode ?? "").toLowerCase().includes(productQuery),
      )
    : products;

  // Same rule for both tables on the Остатки tab — the point of searching
  // here is "where is this product and what happened to it", so the balance
  // and its history have to answer about the same product. Movements carry no
  // SKU of their own, hence the lookup through the already-loaded catalogue.
  const stockQuery = stockSearch.trim().toLowerCase();
  const skuByProductId = new Map(products.map((p) => [p.id, (p.sku ?? "").toLowerCase()]));
  const matchesStockQuery = (productId: string, productName: string) =>
    !stockQuery ||
    productName.toLowerCase().includes(stockQuery) ||
    (skuByProductId.get(productId) ?? "").includes(stockQuery);

  const visibleStockLevels = stockLevels.filter((l) => matchesStockQuery(l.productId, l.productName));
  const visibleMovements = movements.filter((m) => matchesStockQuery(m.productId, m.productName));

  const selectedCategory = selectedCategoryId
    ? categories.find((c) => c.id === selectedCategoryId) ?? null
    : null;
  // Opening a category shows what is in it AND in its subcategories.
  const categoryIdSet = selectedCategoryId ? new Set(categoryIdsWithDescendants(categories, selectedCategoryId)) : null;
  const categoryProducts = categoryIdSet
    ? products.filter((p) => p.categoryId !== null && categoryIdSet.has(p.categoryId))
    : [];
  const categoryTree = buildCategoryTree(categories, PRODUCT_TYPE_ORDER);

  function startCategory(type?: ProductType, parentId?: string) {
    setEditingCategory(undefined);
    setNewCategoryType(type);
    setNewCategoryParentId(parentId);
    setModal("category");
  }

  function openTab(nextTab: Tab) {
    setTab(nextTab);
    listScrollTop.current = null;
    setSelectedCategoryId(null);
  }

  const loadStock = useCallback(() => {
    Promise.all([
      api.inventory.stockLevels(locationFilter || undefined),
      api.inventory.movements(locationFilter || undefined),
    ])
      .then(([levels, moves]) => {
        setStockLevels(levels);
        setMovements(moves);
      })
      .catch(() => setError("Не удалось загрузить данные склада"));
  }, [locationFilter]);

  const loadProducts = useCallback(() => {
    api.products
      .list(showArchivedProducts)
      .then(setProducts)
      .catch(() => setError("Не удалось загрузить номенклатуру"));
  }, [showArchivedProducts]);

  const loadCategories = useCallback(() => {
    api.categories
      .list(showArchivedCategories)
      .then(setCategories)
      .catch(() => setError("Не удалось загрузить категории"));
  }, [showArchivedCategories]);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadStock();
  }, [loadStock]);

  // Counted over what is actually on screen: this banner sits directly above
  // the table and summarises it, so a search that hides every low-stock row
  // must not leave a warning standing over rows that are all fine.
  const lowStockCount = visibleStockLevels.filter((s) => s.isLow).length;
  const fixedLocationId = isOrgWide ? null : (user?.locationId ?? null);

  async function handleProductArchive(p: ProductDto) {
    try {
      await api.products.archive(p.id);
      loadProducts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать товар");
    }
  }

  async function handleProductRestore(p: ProductDto) {
    try {
      await api.products.restore(p.id);
      loadProducts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить товар");
    }
  }

  async function handleProductDelete(p: ProductDto) {
    if (!confirm(`Удалить товар «${p.name}»? Это действие нельзя отменить.`)) return;
    try {
      await api.products.remove(p.id);
      loadProducts();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось удалить товар");
    }
  }

  function handleProductForceDeleted() {
    setForceDeleteProduct(undefined);
    loadProducts();
    loadStock();
  }

  async function handleCategoryArchive(c: CategoryDto) {
    try {
      await api.categories.archive(c.id);
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать категорию");
    }
  }

  async function handleCategoryRestore(c: CategoryDto) {
    try {
      await api.categories.restore(c.id);
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить категорию");
    }
  }

  async function handleCategoryDelete(c: CategoryDto) {
    if (!confirm(`Удалить категорию «${c.name}»? Это действие нельзя отменить.`)) return;
    try {
      await api.categories.remove(c.id);
      loadCategories();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось удалить категорию");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Склад</h1>
          <p className="mt-1 text-sm text-muted">Остатки, номенклатура и категории по точкам</p>
        </div>
        {canManageInventory && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setModal("receive")}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <ArrowDownCircle className="h-4 w-4" strokeWidth={1.75} />
              Приёмка
            </button>
            <button
              onClick={() => setModal("write-off")}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <ArrowUpCircle className="h-4 w-4" strokeWidth={1.75} />
              Списание
            </button>
            <button
              onClick={() => setModal("adjustment")}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <Wrench className="h-4 w-4" strokeWidth={1.75} />
              Корректировка
            </button>
            {canVoidStock && (
              <button
                onClick={() => setModal("void")}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Ban className="h-4 w-4" strokeWidth={1.75} />
                Аннулировать
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <TabButton active={tab === "stock"} onClick={() => openTab("stock")}>
            Остатки
          </TabButton>
          <TabButton active={tab === "catalog"} onClick={() => openTab("catalog")}>
            Номенклатура
          </TabButton>
          <TabButton active={tab === "categories"} onClick={() => openTab("categories")}>
            Категории
          </TabButton>
          <TabButton active={tab === "prices"} onClick={() => openTab("prices")}>
            Цены по точкам
          </TabButton>
          <TabButton active={tab === "stocktake"} onClick={() => openTab("stocktake")}>
            Инвентаризация
          </TabButton>
        </div>

        <div className="flex items-center gap-3">
          {tab === "stock" && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                strokeWidth={1.75}
              />
              <input
                type="text"
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder="Поиск по названию или артикулу…"
                className="w-64 rounded-xl border border-border bg-surface py-2 pl-9 pr-9 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {stockSearch && (
                <button
                  onClick={() => setStockSearch("")}
                  aria-label="Очистить поиск"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}

          {tab === "stock" && isOrgWide && (
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Все точки</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}

          {tab === "catalog" && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                strokeWidth={1.75}
              />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Поиск по названию, артикулу или штрихкоду…"
                className="w-64 rounded-xl border border-border bg-surface py-2 pl-9 pr-9 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {productSearch && (
                <button
                  onClick={() => setProductSearch("")}
                  aria-label="Очистить поиск"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}

          {tab === "catalog" && canManageProducts && (
            <ArchivedToggle checked={showArchivedProducts} onChange={setShowArchivedProducts} />
          )}
          {tab === "categories" && !selectedCategory && canManageProducts && (
            <ArchivedToggle checked={showArchivedCategories} onChange={setShowArchivedCategories} />
          )}
          {tab === "categories" && selectedCategory && canManageProducts && (
            <ArchivedToggle checked={showArchivedProducts} onChange={setShowArchivedProducts} />
          )}

          {tab === "catalog" && canManageProducts && (
            <button
              onClick={() => {
                setEditingProduct(undefined);
                setNewProductCategoryId(undefined);
                setModal("product");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый товар
            </button>
          )}
          {tab === "categories" && !selectedCategory && canDelete && (
            <button
              onClick={() => setModal("standard-catalog")}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              Стандартный каталог
            </button>
          )}
          {tab === "categories" && !selectedCategory && canDelete && (
            <button
              onClick={() => setModal("classification")}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              Классификация
            </button>
          )}
          {tab === "categories" && !selectedCategory && canManageProducts && (
            <button
              onClick={() => startCategory()}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новая категория
            </button>
          )}
          {tab === "categories" && selectedCategory && canManageProducts && (
            <button
              onClick={() => {
                setEditingProduct(undefined);
                setNewProductCategoryId(selectedCategory.id);
                setModal("product");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый товар в категории
            </button>
          )}
        </div>
      </div>

      {tab === "stock" && (
        <>
          {lowStockCount > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {lowStockCount} {lowStockCount === 1 ? "товар с низким остатком" : "товара(ов) с низким остатком"}
            </div>
          )}

          <div className="mb-8 rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Товар</th>
                  {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                  <th className="px-5 py-3 font-medium">Категория</th>
                  <th className="px-5 py-3 text-right font-medium">Остаток</th>
                  <th className="px-5 py-3 text-right font-medium">Мин.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleStockLevels.map((level) => (
                  <tr key={level.id}>
                    <td className="px-5 py-3 font-medium text-foreground">{level.productName}</td>
                    {isOrgWide && <td className="px-5 py-3 text-muted">{level.locationName}</td>}
                    <td className="px-5 py-3 text-muted">{level.categoryName ?? "—"}</td>
                    <td
                      className={clsx(
                        "px-5 py-3 text-right font-medium",
                        level.isLow ? "text-amber-600" : "text-foreground",
                      )}
                    >
                      {formatQuantity(level.quantity)} {UNIT_LABELS_RU[level.unit]}
                    </td>
                    <td className="px-5 py-3 text-right text-muted">
                      {formatQuantity(level.minQuantity)} {UNIT_LABELS_RU[level.unit]}
                    </td>
                  </tr>
                ))}
                {/* An empty search result must not read as an empty warehouse
                    — that is a different fact and would send someone looking
                    for a stock problem that isn't there. */}
                {visibleStockLevels.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                      {stockQuery
                        ? `Ничего не найдено по запросу «${stockSearch.trim()}»`
                        : "Нет данных об остатках"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">История движений</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Товар</th>
                  {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">Причина</th>
                  <th className="px-5 py-3 text-right font-medium">Кол-во</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-muted">{formatDateTime(m.createdAt)}</td>
                    <td className="px-5 py-3 font-medium text-foreground">{m.productName}</td>
                    {isOrgWide && <td className="px-5 py-3 text-muted">{m.locationName}</td>}
                    <td className="px-5 py-3 text-muted">
                      {STOCK_MOVEMENT_TYPE_LABELS_RU[m.type]}
                      {m.voided && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">аннулировано</span>}
                    </td>
                    <td className="px-5 py-3 text-muted">{m.reason ?? "—"}</td>
                    <td
                      className={clsx(
                        "px-5 py-3 text-right font-medium",
                        m.type === StockMovementType.ADJUSTMENT && m.quantity > 0
                          ? "text-green-600"
                          : m.type === StockMovementType.ADJUSTMENT && m.quantity < 0
                            ? "text-red-600"
                            : "text-foreground",
                      )}
                    >
                      {m.type === StockMovementType.ADJUSTMENT && m.quantity > 0 ? "+" : ""}
                      {formatQuantity(m.quantity)} {UNIT_LABELS_RU[m.unit]}
                    </td>
                  </tr>
                ))}
                {visibleMovements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                      {stockQuery
                        ? `Ничего не найдено по запросу «${stockSearch.trim()}»`
                        : "Движений пока нет"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "prices" && <LocationPricesTab locations={locations} canManage={canManageProducts} />}

      {tab === "stocktake" && <StocktakeTab locations={locations} />}

      {tab === "catalog" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Артикул</th>
                <th className="px-5 py-3 font-medium">Штрихкод</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 font-medium">Категория</th>
                <th className="px-5 py-3 font-medium">Единица</th>
                <th className="px-5 py-3 text-right font-medium">Цена</th>
                <th className="px-5 py-3 text-right font-medium">Мин. остаток</th>
                {canManageProducts && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleProducts.map((p) => (
                <tr key={p.id} className={clsx(!p.isActive && "opacity-60")}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      {p.name}
                      {!p.isActive && <ArchivedBadge />}
                      {!p.trackInventory && (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted">
                          Без учёта склада
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted">{p.sku}</td>
                  <td className="px-5 py-3 text-muted">{p.barcode ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{PRODUCT_TYPE_LABELS_RU[p.type]}</td>
                  <td className="px-5 py-3 text-muted">{p.categoryName ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{UNIT_LABELS_RU[p.unit]}</td>
                  <td className="px-5 py-3 text-right font-medium text-foreground">
                    {formatMoney(p.price)}
                  </td>
                  <td className="px-5 py-3 text-right text-muted">
                    {p.trackInventory ? `${formatQuantity(p.minQuantity)} ${UNIT_LABELS_RU[p.unit]}` : "—"}
                  </td>
                  {canManageProducts && (
                    <td className="px-5 py-3">
                      <RowActions
                        isActive={p.isActive}
                        onEdit={() => {
                          setEditingProduct(p);
                          setModal("product");
                        }}
                        // Only for what the bakery makes itself: a bought-in
                        // raw material already arrives labelled by whoever
                        // produced it.
                        onLabels={
                          p.type === ProductType.FINISHED_GOOD ? () => setLabelProduct(p) : undefined
                        }
                        onArchive={() => handleProductArchive(p)}
                        onRestore={() => handleProductRestore(p)}
                        onDelete={canDelete ? () => handleProductDelete(p) : undefined}
                        onForceDelete={canForceDelete ? () => setForceDeleteProduct(p) : undefined}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {/* Kept distinct from "Товаров пока нет": an empty search result
                  and an empty catalogue are different situations, and showing
                  the same text for both hides which one you're looking at. */}
              {visibleProducts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-sm text-muted">
                    {productQuery ? `Ничего не найдено по запросу «${productSearch.trim()}»` : "Товаров пока нет"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "categories" && !selectedCategory && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 text-right font-medium">Порядок</th>
                <th className="px-5 py-3 text-right font-medium">Товаров</th>
                {canManageProducts && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody>
              {categoryTree.map((group) => (
                <CategoryGroupRows
                  key={group.type ?? "legacy"}
                  group={group}
                  canManage={canManageProducts}
                  canDelete={canDelete}
                  onSelect={(c) => openCategory(c.id)}
                  onAdd={(type, parentId) => startCategory(type, parentId)}
                  onEdit={(c) => {
                    setEditingCategory(c);
                    setModal("category");
                  }}
                  onArchive={handleCategoryArchive}
                  onRestore={handleCategoryRestore}
                  onDelete={handleCategoryDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "categories" && selectedCategory && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedCategoryId(null)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition hover:bg-surface-muted hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                Категории
              </button>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {categoryPathLabel(selectedCategory, categories)}
                {!selectedCategory.isActive && <ArchivedBadge />}
              </h2>
            </div>
            <span className="text-sm text-muted">
              {categoryProducts.length} {categoryProducts.length === 1 ? "товар" : "товаров"}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Артикул</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 font-medium">Единица</th>
                <th className="px-5 py-3 text-right font-medium">Цена</th>
                <th className="px-5 py-3 text-right font-medium">Мин. остаток</th>
                {canManageProducts && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categoryProducts.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => {
                    setEditingProduct(p);
                    setModal("product");
                  }}
                  className={clsx("cursor-pointer transition hover:bg-surface-muted", !p.isActive && "opacity-60")}
                >
                  <td className="px-5 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      {p.name}
                      {!p.isActive && <ArchivedBadge />}
                      {!p.trackInventory && (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted">
                          Без учёта склада
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted">{p.sku}</td>
                  <td className="px-5 py-3 text-muted">{PRODUCT_TYPE_LABELS_RU[p.type]}</td>
                  <td className="px-5 py-3 text-muted">{UNIT_LABELS_RU[p.unit]}</td>
                  <td className="px-5 py-3 text-right font-medium text-foreground">
                    {formatMoney(p.price)}
                  </td>
                  <td className="px-5 py-3 text-right text-muted">
                    {p.trackInventory ? `${formatQuantity(p.minQuantity)} ${UNIT_LABELS_RU[p.unit]}` : "—"}
                  </td>
                  {canManageProducts && (
                    <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        isActive={p.isActive}
                        onEdit={() => {
                          setEditingProduct(p);
                          setModal("product");
                        }}
                        // Only for what the bakery makes itself: a bought-in
                        // raw material already arrives labelled by whoever
                        // produced it.
                        onLabels={
                          p.type === ProductType.FINISHED_GOOD ? () => setLabelProduct(p) : undefined
                        }
                        onArchive={() => handleProductArchive(p)}
                        onRestore={() => handleProductRestore(p)}
                        onDelete={canDelete ? () => handleProductDelete(p) : undefined}
                        onForceDelete={canForceDelete ? () => setForceDeleteProduct(p) : undefined}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {categoryProducts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    В этой категории пока нет товаров
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(modal === "receive" || modal === "write-off" || modal === "adjustment") && (
        <StockMovementModal
          mode={modal}
          locations={locations}
          products={products.filter((p) => p.isActive && p.trackInventory)}
          stockLevels={stockLevels}
          fixedLocationId={fixedLocationId}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            loadStock();
          }}
        />
      )}

      {modal === "void" && (
        <StockVoidModal
          products={products.filter((p) => p.trackInventory)}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            loadStock();
          }}
        />
      )}

      {labelProduct && (
        <LabelPrintModal product={labelProduct} onClose={() => setLabelProduct(undefined)} />
      )}

      {modal === "product" && (
        <NewProductModal
          categories={categories}
          product={editingProduct}
          defaultCategoryId={newProductCategoryId}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setNewProductCategoryId(undefined);
            loadProducts();
          }}
        />
      )}

      {modal === "category" && (
        <CategoryModal
          category={editingCategory}
          categories={categories}
          defaultType={newCategoryType}
          defaultParentId={newCategoryParentId}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            loadCategories();
          }}
        />
      )}

      {modal === "standard-catalog" && (
        <StandardCatalogModal
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            loadCategories();
          }}
        />
      )}

      {modal === "classification" && (
        <ClassificationModal
          onClose={() => setModal(null)}
          onChanged={loadCategories}
        />
      )}

      {forceDeleteProduct && (
        <ForceDeleteProductModal
          product={forceDeleteProduct}
          onClose={() => setForceDeleteProduct(undefined)}
          onDeleted={handleProductForceDeleted}
        />
      )}
    </div>
  );
}

// One product type's block of the category tree: the type header, then each
// category with its subcategories indented beneath it.
function CategoryGroupRows({
  group,
  canManage,
  canDelete,
  onSelect,
  onAdd,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  group: CategoryTypeGroup;
  canManage: boolean;
  canDelete: boolean;
  onSelect: (c: CategoryDto) => void;
  onAdd: (type: ProductType | undefined, parentId?: string) => void;
  onEdit: (c: CategoryDto) => void;
  onArchive: (c: CategoryDto) => void;
  onRestore: (c: CategoryDto) => void;
  onDelete: (c: CategoryDto) => void;
}) {
  const row = (c: CategoryDto, indent: boolean, count: number) => (
    <tr
      key={c.id}
      onClick={() => onSelect(c)}
      className={clsx("cursor-pointer border-b border-border transition last:border-0 hover:bg-surface-muted", !c.isActive && "opacity-60")}
    >
      <td className={clsx("py-3 pr-5 text-foreground", indent ? "pl-12" : "pl-9 font-medium")}>
        <div className="flex items-center gap-2">
          {c.name}
          {!c.isActive && <ArchivedBadge />}
        </div>
      </td>
      {/* The list is already sorted by this, so the column is really there to
          show which categories have been ordered at all. */}
      <td className="px-5 py-3 text-right text-muted">{c.sortOrder ?? "—"}</td>
      <td className="px-5 py-3 text-right text-muted">{count}</td>
      {canManage && (
        <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            {!indent && c.isActive && c.type !== null && (
              <button
                onClick={() => onAdd(undefined, c.id)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-accent transition hover:bg-surface-muted"
              >
                + Подкатегория
              </button>
            )}
            <RowActions
              isActive={c.isActive}
              onEdit={() => onEdit(c)}
              onArchive={() => onArchive(c)}
              onRestore={() => onRestore(c)}
              onDelete={canDelete ? () => onDelete(c) : undefined}
            />
          </div>
        </td>
      )}
    </tr>
  );

  return (
    <>
      <tr className="border-b border-border bg-surface-muted/60">
        <td colSpan={canManage ? 3 : 3} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {group.type ? PRODUCT_TYPE_LABELS_RU[group.type] : "Без типа (прежние категории)"}
        </td>
        {canManage && (
          <td className="px-5 py-2">
            {group.type && (
              <button
                onClick={() => onAdd(group.type ?? undefined)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-accent transition hover:bg-surface"
              >
                + Категория
              </button>
            )}
          </td>
        )}
      </tr>
      {group.nodes.length === 0 && (
        <tr className="border-b border-border">
          <td colSpan={canManage ? 4 : 3} className="px-9 py-3 text-sm text-muted">
            Категорий пока нет
          </td>
        </tr>
      )}
      {group.nodes.map((node) => (
        <Fragment key={node.category.id}>
          {row(node.category, false, node.category.totalProductCount)}
          {node.children.map((child) => row(child, true, child.productCount))}
        </Fragment>
      ))}
    </>
  );
}

function TabButton({
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
