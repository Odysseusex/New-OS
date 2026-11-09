"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Calculator, Copy, FileDown, Plus, Search, Trash2, XCircle } from "lucide-react";
import type { LocationDto, ProductDto, ProductionBatchDto, RecipeDto } from "@bakery-os/shared";
import {
  HARD_DELETE_ROLES,
  ORG_WIDE_ROLES,
  PRODUCTION_BATCH_STATUS_LABELS_RU,
  PRODUCTION_CANCEL_REASON_LABELS_RU,
  PRODUCTION_MANAGE_ROLES,
  ProductionBatchStatus,
  ProductType,
  RECIPE_MANAGE_ROLES,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { AbortBatchModal } from "@/components/abort-batch-modal";
import { ProductionReleaseModal } from "@/components/production-release-modal";
import { DistributionTab } from "@/components/distribution-tab";
import { ProductionDeviationsTab } from "@/components/production-deviations-tab";
import { ProductionOutputTab } from "@/components/production-output-tab";
import { RequisitionsTab } from "@/components/requisitions-tab";
import { ProductionDocumentModal } from "@/components/production-document-modal";
import { NewRecipeModal } from "@/components/new-recipe-modal";
import { ExportRecipesPdfModal } from "@/components/export-recipes-pdf-modal";
import { RecipeScaleModal } from "@/components/recipe-scale-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

type Tab = "batches" | "distribution" | "recipes" | "requisitions" | "output" | "deviations";

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
  const [modal, setModal] = useState<"release" | "recipe" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<RecipeDto | undefined>(undefined);
  const [duplicateFromRecipe, setDuplicateFromRecipe] = useState<RecipeDto | undefined>(undefined);
  const [abortingBatch, setAbortingBatch] = useState<ProductionBatchDto | null>(null);
  const [documentBatchId, setDocumentBatchId] = useState<string | null>(null);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());
  const [exportingRecipes, setExportingRecipes] = useState<RecipeDto[] | null>(null);
  const [scaling, setScaling] = useState<{ recipe: RecipeDto; quantity?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBatches = useCallback(() => {
    api.production
      .batches(locationFilter || undefined)
      .then(setBatches)
      .catch(() => setError("Не удалось загрузить производственные задания"));
  }, [locationFilter]);

  const loadRecipes = useCallback(() => {
    // Always fetched including archived ones — `existingRecipeProductIds`
    // (passed to NewRecipeModal below) needs to know about archived recipes
    // too, since a product keeps at most one Recipe row ever (archived or
    // not) and offering it again as "no recipe yet" just hits a 409 on
    // save. The archived toggle filters client-side instead (visibleRecipes).
    api.recipes
      .list(true)
      .then(setRecipes)
      .catch(() => setError("Не удалось загрузить рецептуры"));
  }, []);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
    api.products.list().then(setProducts).catch(() => {});
    loadRecipes();
  }, [loadRecipes]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const fixedLocationId = isOrgWide ? null : (user?.locationId ?? null);

  async function handleDelete(batch: ProductionBatchDto) {
    if (!confirm(`Удалить задание «${batch.productName}»? Это действие нельзя отменить.`)) return;
    try {
      await api.production.deleteBatch(batch.id);
      loadBatches();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить задание");
    }
  }

  async function handleRecipeArchive(recipe: RecipeDto) {
    if (!confirm(`Заархивировать рецептуру «${recipe.productName}»? Она пропадёт из общего списка, но данные сохранятся — её можно будет восстановить.`))
      return;
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

  function toggleRecipeSelection(id: string) {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleRecipes = recipes.filter(
    (r) =>
      (showArchivedRecipes || r.isActive) &&
      r.productName.toLowerCase().includes(recipeSearch.trim().toLowerCase()),
  );

  const selectedRecipes = recipes.filter((r) => selectedRecipeIds.has(r.id));

  // Newest output first; a batch left from the old plan → start → finish flow sits by its plan date.
  const visibleBatches = [...batches].sort((a, b) => (b.completedAt ?? b.scheduledFor).localeCompare(a.completedAt ?? a.scheduledFor));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Производство</h1>
          <p className="mt-1 text-sm text-muted">Выпуск продукции и рецептуры</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {notice && <div className="mb-6 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>}

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <TabButton active={tab === "batches"} onClick={() => setTab("batches")}>
            Журнал выпуска
          </TabButton>
          <TabButton active={tab === "distribution"} onClick={() => setTab("distribution")}>
            Распределение
          </TabButton>
          <TabButton active={tab === "recipes"} onClick={() => setTab("recipes")}>
            Рецептуры
          </TabButton>
          <TabButton active={tab === "requisitions"} onClick={() => setTab("requisitions")}>
            Требования
          </TabButton>
          <TabButton active={tab === "output"} onClick={() => setTab("output")}>
            Выпуск
          </TabButton>
          <TabButton active={tab === "deviations"} onClick={() => setTab("deviations")}>
            Отклонения
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
              onClick={() => {
                setNotice(null);
                setModal("release");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Выпуск за день
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

          {tab === "recipes" && selectedRecipeIds.size > 0 && (
            <button
              onClick={() => setExportingRecipes(selectedRecipes)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <FileDown className="h-4 w-4" strokeWidth={1.75} />
              Экспорт PDF ({selectedRecipeIds.size})
            </button>
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

      {tab === "distribution" && <DistributionTab locations={locations} />}
      {tab === "requisitions" && <RequisitionsTab locations={locations} products={products} />}
      {tab === "output" && <ProductionOutputTab locations={locations} isOrgWide={isOrgWide} />}
      {tab === "deviations" && <ProductionDeviationsTab locations={locations} isOrgWide={isOrgWide} />}

      {tab === "batches" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Продукция</th>
                {isOrgWide && <th className="px-5 py-3 font-medium">Цех</th>}
                <th className="px-5 py-3 text-right font-medium">Вышло</th>
                <th className="px-5 py-3 font-medium">Документ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleBatches.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-5 py-3 text-muted">{formatDateTime(batch.completedAt ?? batch.scheduledFor)}</td>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <span className="flex items-center gap-1.5">
                      {batch.productName}
                      {recipes.some((r) => r.id === batch.recipeId && r.isActive) && (
                        <button
                          onClick={() => {
                            const recipe = recipes.find((r) => r.id === batch.recipeId);
                            if (recipe) setScaling({ recipe, quantity: batch.actualQuantity ?? batch.plannedQuantity });
                          }}
                          title="Расчёт ингредиентов"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                        >
                          <Calculator className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      )}
                    </span>
                  </td>
                  {isOrgWide && <td className="px-5 py-3 text-muted">{batch.locationName}</td>}
                  <td className="px-5 py-3 text-right text-foreground">
                    {batch.actualQuantity !== null ? `${formatQuantity(batch.actualQuantity)} ${UNIT_LABELS_RU[batch.unit]}` : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {batch.status === ProductionBatchStatus.COMPLETED && (
                      <>
                        <button onClick={() => setDocumentBatchId(batch.id)} className="text-sm font-medium text-accent hover:underline">
                          Акт выпуска
                        </button>
                        {batch.recipeVersionNumber !== null && (
                          <p className="mt-0.5 text-xs text-muted">по версии техкарты {batch.recipeVersionNumber}</p>
                        )}
                      </>
                    )}
                    {batch.status === ProductionBatchStatus.CANCELLED && (
                      <p className="text-xs text-muted">
                        <StatusBadge status={batch.status} />
                        {batch.cancelReason && ` ${PRODUCTION_CANCEL_REASON_LABELS_RU[batch.cancelReason]}`}
                        {batch.cancelNote ? ` — ${batch.cancelNote}` : ""}
                      </p>
                    )}
                    {/* Left over from the old plan → start → finish flow: only removing it is offered. */}
                    {(batch.status === ProductionBatchStatus.PLANNED || batch.status === ProductionBatchStatus.IN_PROGRESS) && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">Не проведено (план {formatQuantity(batch.plannedQuantity)})</span>
                        {canManageProduction && (
                          <button
                            onClick={() => (batch.status === ProductionBatchStatus.PLANNED ? handleDelete(batch) : setAbortingBatch(batch))}
                            title={batch.status === ProductionBatchStatus.PLANNED ? "Удалить" : "Прервать"}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                          >
                            {batch.status === ProductionBatchStatus.PLANNED ? (
                              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                            ) : (
                              <XCircle className="h-4 w-4" strokeWidth={1.75} />
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {visibleBatches.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                    Выпусков пока нет
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
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={selectedRecipeIds.has(recipe.id)}
                    onChange={() => toggleRecipeSelection(recipe.id)}
                    className="mt-1 h-4 w-4 rounded border-border accent-accent"
                  />
                  <div>
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      {recipe.productName}{recipe.productType === ProductType.SEMI_FINISHED && " (полуфабрикат)"}
                      {!recipe.isActive && <ArchivedBadge />}
                    </p>
                    <p className="text-xs text-muted">
                      Выход: {recipe.yieldQuantity} {UNIT_LABELS_RU[recipe.productUnit]}
                      {recipe.versions[0] && ` · версия ${recipe.versions[0].number} с ${formatDate(recipe.versions[0].validFrom)}, автор ${recipe.versions[0].createdByName}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted">
                    {formatMoney(recipe.productPrice)}
                  </span>
                  {recipe.isActive && (
                    <button
                      onClick={() => setScaling({ recipe })}
                      title="Расчёт на количество"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                    >
                      <Calculator className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                  <button
                    onClick={() => setExportingRecipes([recipe])}
                    title="Экспорт PDF"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                  >
                    <FileDown className="h-4 w-4" strokeWidth={1.75} />
                  </button>
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
                    <span className="text-muted">
                      {item.ingredientProductName}
                      {item.ingredientType === ProductType.SEMI_FINISHED && " (полуфабрикат)"}
                      {item.ingredientType === ProductType.FINISHED_GOOD && " (готовая продукция)"}
                    </span>
                    <span className="text-foreground">
                      {formatQuantity(item.quantity)} {UNIT_LABELS_RU[item.unit]}
                      {item.lossPercent !== null && item.lossPercent > 0 && (
                        <span className="ml-1.5 text-xs text-muted">
                          −{formatQuantity(item.lossPercent)}% → нетто {formatQuantity(item.netQuantity)} {UNIT_LABELS_RU[item.unit]}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {recipe.uncountedWarning && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{recipe.uncountedWarning}</p>
              )}
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
                    {recipe.markupPercent !== null && recipe.markupPercent !== undefined && ` · Наценка ${recipe.markupPercent.toFixed(0)}%`}
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

      {modal === "release" && (
        <ProductionReleaseModal
          locations={locations}
          products={products}
          recipes={recipes}
          fixedLocationId={fixedLocationId}
          onClose={() => setModal(null)}
          onDone={(message) => {
            setModal(null);
            setNotice(message);
            loadBatches();
          }}
        />
      )}

      {modal === "recipe" && (
        <NewRecipeModal
          products={products.filter((p) => p.isActive)}
          existingRecipeProductIds={recipes.map((r) => r.productId)}
          allRecipes={recipes}
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

      {documentBatchId && <ProductionDocumentModal batchId={documentBatchId} onClose={() => setDocumentBatchId(null)} />}

      {abortingBatch && (
        <AbortBatchModal
          batch={abortingBatch}
          onClose={() => setAbortingBatch(null)}
          onAborted={() => {
            setAbortingBatch(null);
            loadBatches();
          }}
        />
      )}

      {scaling && (
        <RecipeScaleModal recipe={scaling.recipe} initialQuantity={scaling.quantity} onClose={() => setScaling(null)} />
      )}

      {exportingRecipes && (
        <ExportRecipesPdfModal
          recipes={exportingRecipes}
          onClose={() => {
            setExportingRecipes(null);
            setSelectedRecipeIds(new Set());
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ProductionBatchStatus }) {
  const styles: Record<ProductionBatchStatus, string> = {
    [ProductionBatchStatus.PLANNED]: "bg-amber-50 text-amber-700",
    [ProductionBatchStatus.IN_PROGRESS]: "bg-blue-50 text-blue-700",
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
