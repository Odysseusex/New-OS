"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Copy, Plus, Search, XCircle } from "lucide-react";
import type { LocationDto, ProductDto, ProductionBatchDto, RecipeDto } from "@bakery-os/shared";
import {
  HARD_DELETE_ROLES,
  ORG_WIDE_ROLES,
  PRODUCTION_BATCH_STATUS_LABELS_RU,
  PRODUCTION_MANAGE_ROLES,
  ProductionBatchStatus,
  RECIPE_MANAGE_ROLES,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { NewBatchModal } from "@/components/new-batch-modal";
import { CompleteBatchModal } from "@/components/complete-batch-modal";
import { NewRecipeModal } from "@/components/new-recipe-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

type Tab = "batches" | "recipes";

export default function ProductionPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const canManageProduction = user ? PRODUCTION_MANAGE_ROLES.includes(user.role) : false;
  const canManageRecipes = user ? RECIPE_MANAGE_ROLES.includes(user.role) : false;
  const canDelete = user ? HARD_DELETE_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("batches");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [recipes, setRecipes] = useState<RecipeDto[]>([]);
  const [batches, setBatches] = useState<ProductionBatchDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [showArchivedRecipes, setShowArchivedRecipes] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [modal, setModal] = useState<"batch" | "recipe" | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<RecipeDto | undefined>(undefined);
  const [duplicateFromRecipe, setDuplicateFromRecipe] = useState<RecipeDto | undefined>(undefined);
  const [completingBatch, setCompletingBatch] = useState<ProductionBatchDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBatches = useCallback(() => {
    api.production
      .batches(locationFilter || undefined)
      .then(setBatches)
      .catch(() => setError("Не удалось загрузить производственные задания"));
  }, [locationFilter]);

  const loadRecipes = useCallback(() => {
    api.recipes
      .list(showArchivedRecipes)
      .then(setRecipes)
      .catch(() => setError("Не удалось загрузить рецептуры"));
  }, [showArchivedRecipes]);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
    api.products.list().then(setProducts).catch(() => {});
    loadRecipes();
  }, [loadRecipes]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const fixedLocationId = isOrgWide ? null : (user?.locationId ?? null);

  async function handleCancel(batch: ProductionBatchDto) {
    try {
      await api.production.cancelBatch(batch.id);
      loadBatches();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить задание");
    }
  }

  async function handleRecipeArchive(recipe: RecipeDto) {
    try {
      await api.recipes.archive(recipe.id);
      loadRecipes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать рецептуру");
    }
  }

  async function handleRecipeRestore(recipe: RecipeDto) {
    try {
      await api.recipes.restore(recipe.id);
      loadRecipes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить рецептуру");
    }
  }

  async function handleRecipeDelete(recipe: RecipeDto) {
    if (!confirm(`Удалить рецептуру «${recipe.productName}»? Это действие нельзя отменить.`)) return;
    try {
      await api.recipes.remove(recipe.id);
      loadRecipes();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось удалить рецептуру");
    }
  }

  const visibleRecipes = recipes.filter((r) =>
    r.productName.toLowerCase().includes(recipeSearch.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Производство</h1>
          <p className="mt-1 text-sm text-muted">Рецептуры и производственные задания</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <TabButton active={tab === "batches"} onClick={() => setTab("batches")}>
            Задания
          </TabButton>
          <TabButton active={tab === "recipes"} onClick={() => setTab("recipes")}>
            Рецептуры
          </TabButton>
        </div>

        <div className="flex items-center gap-3">
          {tab === "batches" && isOrgWide && (
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Все производства</option>
              {locations
                .filter((l) => l.type === "BAKERY_PRODUCTION")
                .map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
            </select>
          )}

          {tab === "batches" && canManageProduction && (
            <button
              onClick={() => setModal("batch")}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новое задание
            </button>
          )}

          {tab === "recipes" && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
              <input
                type="text"
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                placeholder="Поиск по названию…"
                className="w-56 rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          )}

          {tab === "recipes" && canManageRecipes && (
            <ArchivedToggle checked={showArchivedRecipes} onChange={setShowArchivedRecipes} />
          )}

          {tab === "recipes" && canManageRecipes && (
            <button
              onClick={() => {
                setEditingRecipe(undefined);
                setModal("recipe");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новая рецептура
            </button>
          )}
        </div>
      </div>

      {tab === "batches" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Товар</th>
                {isOrgWide && <th className="px-5 py-3 font-medium">Производство</th>}
                <th className="px-5 py-3 text-right font-medium">План</th>
                <th className="px-5 py-3 text-right font-medium">Факт</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Дата</th>
                {canManageProduction && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{batch.productName}</td>
                  {isOrgWide && <td className="px-5 py-3 text-muted">{batch.locationName}</td>}
                  <td className="px-5 py-3 text-right text-muted">
                    {formatQuantity(batch.plannedQuantity)} {UNIT_LABELS_RU[batch.unit]}
                  </td>
                  <td className="px-5 py-3 text-right text-foreground">
                    {batch.actualQuantity !== null
                      ? `${formatQuantity(batch.actualQuantity)} ${UNIT_LABELS_RU[batch.unit]}`
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={batch.status} />
                  </td>
                  <td className="px-5 py-3 text-muted">{formatDateTime(batch.scheduledFor)}</td>
                  {canManageProduction && (
                    <td className="px-5 py-3">
                      {batch.status === ProductionBatchStatus.PLANNED && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setCompletingBatch(batch)}
                            title="Завершить"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-green-600"
                          >
                            <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={() => handleCancel(batch)}
                            title="Отменить"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                          >
                            <XCircle className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    Заданий пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "recipes" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleRecipes.map((recipe) => (
            <div key={recipe.id} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="flex items-center gap-2 font-medium text-foreground">
                    {recipe.productName}
                    {!recipe.isActive && <ArchivedBadge />}
                  </p>
                  <p className="text-xs text-muted">
                    Выход: {recipe.yieldQuantity} {UNIT_LABELS_RU[recipe.productUnit]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted">
                    {formatMoney(recipe.productPrice)}
                  </span>
                  {canManageRecipes && (
                    <button
                      onClick={() => {
                        setDuplicateFromRecipe(recipe);
                        setEditingRecipe(undefined);
                        setModal("recipe");
                      }}
                      title="Дублировать"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                    >
                      <Copy className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                  {canManageRecipes && (
                    <RowActions
                      isActive={recipe.isActive}
                      onEdit={() => {
                        setEditingRecipe(recipe);
                        setDuplicateFromRecipe(undefined);
                        setModal("recipe");
                      }}
                      onArchive={() => handleRecipeArchive(recipe)}
                      onRestore={() => handleRecipeRestore(recipe)}
                      onDelete={canDelete ? () => handleRecipeDelete(recipe) : undefined}
                    />
                  )}
                </div>
              </div>

              {((recipe.stages ?? []).length > 0 || recipe.shelfLifeDays !== null) && (
                <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted">
                  {(recipe.stages ?? []).length > 0 && (
                    <span>
                      Технология: {(recipe.stages ?? []).map((s) => s.stageTypeName).join(" → ")}
                    </span>
                  )}
                  {recipe.shelfLifeDays !== null && <span>· Срок годности: {recipe.shelfLifeDays} дн.</span>}
                </div>
              )}

              <ul className="mb-4 space-y-1">
                {recipe.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted">{item.ingredientProductName}</span>
                    <span className="text-foreground">
                      {formatQuantity(item.quantity)} {UNIT_LABELS_RU[item.unit]}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted">Себестоимость: {formatMoney(recipe.unitCost)}</span>
                {recipe.marginPercent !== null && (
                  <span
                    className={clsx(
                      "font-medium",
                      recipe.marginPercent >= 0 ? "text-green-600" : "text-red-600",
                    )}
                  >
                    Маржа {recipe.marginPercent.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          ))}
          {visibleRecipes.length === 0 && (
            <p className="col-span-2 py-8 text-center text-sm text-muted">
              {recipes.length === 0 ? "Рецептур пока нет" : "Ничего не найдено"}
            </p>
          )}
        </div>
      )}

      {modal === "batch" && (
        <NewBatchModal
          locations={locations}
          recipes={recipes.filter((r) => r.isActive)}
          fixedLocationId={fixedLocationId}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            loadBatches();
          }}
        />
      )}

      {modal === "recipe" && (
        <NewRecipeModal
          products={products.filter((p) => p.isActive)}
          existingRecipeProductIds={recipes.map((r) => r.productId)}
          recipe={editingRecipe}
          duplicateFrom={duplicateFromRecipe}
          onClose={() => {
            setModal(null);
            setDuplicateFromRecipe(undefined);
          }}
          onSaved={() => {
            setModal(null);
            setDuplicateFromRecipe(undefined);
            loadRecipes();
          }}
        />
      )}

      {completingBatch && (
        <CompleteBatchModal
          batch={completingBatch}
          onClose={() => setCompletingBatch(null)}
          onCompleted={() => {
            setCompletingBatch(null);
            loadBatches();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ProductionBatchStatus }) {
  const styles: Record<ProductionBatchStatus, string> = {
    [ProductionBatchStatus.PLANNED]: "bg-amber-50 text-amber-700",
    [ProductionBatchStatus.COMPLETED]: "bg-green-50 text-green-700",
    [ProductionBatchStatus.CANCELLED]: "bg-surface-muted text-muted",
  };
  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", styles[status])}>
      {PRODUCTION_BATCH_STATUS_LABELS_RU[status]}
    </span>
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
