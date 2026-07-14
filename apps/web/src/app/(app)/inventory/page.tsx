"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Plus } from "lucide-react";
import type { CategoryDto, LocationDto, ProductDto, StockLevelDto, StockMovementDto } from "@bakery-os/shared";
import {
  INVENTORY_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  PRODUCT_MANAGE_ROLES,
  PRODUCT_TYPE_LABELS_RU,
  STOCK_MOVEMENT_TYPE_LABELS_RU,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { StockMovementModal } from "@/components/stock-movement-modal";
import { NewProductModal } from "@/components/new-product-modal";
import { CategoryModal } from "@/components/category-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

type Tab = "stock" | "catalog" | "categories";

export default function InventoryPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const canManageInventory = user ? INVENTORY_MANAGE_ROLES.includes(user.role) : false;
  const canManageProducts = user ? PRODUCT_MANAGE_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("stock");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevelDto[]>([]);
  const [movements, setMovements] = useState<StockMovementDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [showArchivedProducts, setShowArchivedProducts] = useState(false);
  const [showArchivedCategories, setShowArchivedCategories] = useState(false);
  const [modal, setModal] = useState<"receive" | "write-off" | "product" | "category" | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductDto | undefined>(undefined);
  const [editingCategory, setEditingCategory] = useState<CategoryDto | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

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

  const lowStockCount = stockLevels.filter((s) => s.isLow).length;
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
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <TabButton active={tab === "stock"} onClick={() => setTab("stock")}>
            Остатки
          </TabButton>
          <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")}>
            Номенклатура
          </TabButton>
          <TabButton active={tab === "categories"} onClick={() => setTab("categories")}>
            Категории
          </TabButton>
        </div>

        <div className="flex items-center gap-3">
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

          {tab === "catalog" && canManageProducts && (
            <ArchivedToggle checked={showArchivedProducts} onChange={setShowArchivedProducts} />
          )}
          {tab === "categories" && canManageProducts && (
            <ArchivedToggle checked={showArchivedCategories} onChange={setShowArchivedCategories} />
          )}

          {tab === "catalog" && canManageProducts && (
            <button
              onClick={() => {
                setEditingProduct(undefined);
                setModal("product");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый товар
            </button>
          )}
          {tab === "categories" && canManageProducts && (
            <button
              onClick={() => {
                setEditingCategory(undefined);
                setModal("category");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новая категория
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
                {stockLevels.map((level) => (
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
                {stockLevels.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                      Нет данных об остатках
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
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-muted">{formatDateTime(m.createdAt)}</td>
                    <td className="px-5 py-3 font-medium text-foreground">{m.productName}</td>
                    {isOrgWide && <td className="px-5 py-3 text-muted">{m.locationName}</td>}
                    <td className="px-5 py-3 text-muted">{STOCK_MOVEMENT_TYPE_LABELS_RU[m.type]}</td>
                    <td className="px-5 py-3 text-muted">{m.reason ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium text-foreground">
                      {formatQuantity(m.quantity)} {UNIT_LABELS_RU[m.unit]}
                    </td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                      Движений пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "catalog" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Артикул</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 font-medium">Категория</th>
                <th className="px-5 py-3 font-medium">Единица</th>
                <th className="px-5 py-3 text-right font-medium">Цена</th>
                {canManageProducts && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((p) => (
                <tr key={p.id} className={clsx(!p.isActive && "opacity-60")}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      {p.name}
                      {!p.isActive && <ArchivedBadge />}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted">{p.sku}</td>
                  <td className="px-5 py-3 text-muted">{PRODUCT_TYPE_LABELS_RU[p.type]}</td>
                  <td className="px-5 py-3 text-muted">{p.categoryName ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{UNIT_LABELS_RU[p.unit]}</td>
                  <td className="px-5 py-3 text-right font-medium text-foreground">
                    {formatMoney(p.price)}
                  </td>
                  {canManageProducts && (
                    <td className="px-5 py-3">
                      <RowActions
                        isActive={p.isActive}
                        onEdit={() => {
                          setEditingProduct(p);
                          setModal("product");
                        }}
                        onArchive={() => handleProductArchive(p)}
                        onRestore={() => handleProductRestore(p)}
                        onDelete={() => handleProductDelete(p)}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    Товаров пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "categories" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 text-right font-medium">Товаров</th>
                {canManageProducts && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categories.map((c) => (
                <tr key={c.id} className={clsx(!c.isActive && "opacity-60")}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      {c.name}
                      {!c.isActive && <ArchivedBadge />}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-muted">{c.productCount}</td>
                  {canManageProducts && (
                    <td className="px-5 py-3">
                      <RowActions
                        isActive={c.isActive}
                        onEdit={() => {
                          setEditingCategory(c);
                          setModal("category");
                        }}
                        onArchive={() => handleCategoryArchive(c)}
                        onRestore={() => handleCategoryRestore(c)}
                        onDelete={() => handleCategoryDelete(c)}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm text-muted">
                    Категорий пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(modal === "receive" || modal === "write-off") && (
        <StockMovementModal
          mode={modal}
          locations={locations}
          products={products.filter((p) => p.isActive)}
          fixedLocationId={fixedLocationId}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            loadStock();
          }}
        />
      )}

      {modal === "product" && (
        <NewProductModal
          categories={categories}
          product={editingProduct}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            loadProducts();
          }}
        />
      )}

      {modal === "category" && (
        <CategoryModal
          category={editingCategory}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            loadCategories();
          }}
        />
      )}
    </div>
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
