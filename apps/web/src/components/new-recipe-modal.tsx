"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { RecipeDto, RecipeStageTypeDto, ProductDto } from "@bakery-os/shared";
import {
  ProductType,
  RECIPE_PARAMETER_KIND_LABELS_RU,
  RECIPE_PARAMETER_KIND_UNIT_RU,
  RecipeParameterKind,
  Unit,
  UNIT_LABELS_RU,
  convertUnitQuantity,
  getCompatibleUnits,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney, formatMoneyPrecise } from "@/lib/format";

interface IngredientRow {
  ingredientProductId: string;
  quantity: string;
  // The unit this row's quantity is currently typed in — not necessarily
  // the ingredient's base/storage unit. Converted to base unit on submit.
  unit: Unit;
}

interface ParameterRow {
  kind: RecipeParameterKind;
  label: string;
  value: string;
}

interface StageRow {
  stageTypeId: string;
  note: string;
  parameters: ParameterRow[];
  // UI-only: true while this row is showing the inline "new stage" text
  // input instead of the dropdown, and what's currently typed into it.
  isCreatingStageType?: boolean;
  newStageTypeName?: string;
}

const NEW_STAGE_TYPE_VALUE = "__new__";

function stagesFromRecipe(recipe: RecipeDto): StageRow[] {
  return (recipe.stages ?? []).map((s) => ({
    stageTypeId: s.stageTypeId,
    note: s.note ?? "",
    parameters: s.parameters.map((p) => ({ kind: p.kind, label: p.label ?? "", value: String(p.value) })),
  }));
}

export function NewRecipeModal({
  products,
  existingRecipeProductIds,
  recipe,
  duplicateFrom,
  onClose,
  onSaved,
}: {
  products: ProductDto[];
  existingRecipeProductIds: string[];
  recipe?: RecipeDto;
  // Pre-fills the form from an existing recipe as a starting point for a
  // new one (a different product) — a plain create under the hood, only
  // the initial state differs.
  duplicateFrom?: RecipeDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const source = recipe ?? duplicateFrom;
  const outputOptions = products.filter(
    (p) => p.type === ProductType.FINISHED_GOOD && !existingRecipeProductIds.includes(p.id),
  );
  const ingredientOptions = products.filter((p) => p.type === ProductType.RAW_MATERIAL);

  const [stageTypes, setStageTypes] = useState<RecipeStageTypeDto[]>([]);

  useEffect(() => {
    api.recipeStageTypes.list().then(setStageTypes).catch(() => {});
  }, []);

  const [productId, setProductId] = useState(recipe?.productId ?? outputOptions[0]?.id ?? "");
  const [yieldQuantity, setYieldQuantity] = useState(recipe ? String(recipe.yieldQuantity) : "");
  const [pieceWeightG, setPieceWeightG] = useState(
    source?.pieceWeightG !== null && source?.pieceWeightG !== undefined ? String(source.pieceWeightG) : "",
  );
  const [generalNotes, setGeneralNotes] = useState(source?.generalNotes ?? "");
  const [rows, setRows] = useState<IngredientRow[]>(
    source && source.items.length > 0
      ? source.items.map((i) => ({ ingredientProductId: i.ingredientProductId, quantity: String(i.quantity), unit: i.unit }))
      : [
          {
            ingredientProductId: ingredientOptions[0]?.id ?? "",
            quantity: "",
            unit: ingredientOptions[0]?.unit ?? Unit.KG,
          },
        ],
  );
  const [stages, setStages] = useState<StageRow[]>(source ? stagesFromRecipe(source) : []);
  const [lossPercent, setLossPercent] = useState(
    source?.lossPercent !== null && source?.lossPercent !== undefined ? String(source.lossPercent) : "",
  );
  const [shelfLifeDays, setShelfLifeDays] = useState(
    source?.shelfLifeDays !== null && source?.shelfLifeDays !== undefined ? String(source.shelfLifeDays) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateRow(index: number, patch: Partial<IngredientRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  // Switching ingredient keeps the typed quantity+unit as-is when the new
  // ingredient's base unit is in the same family (e.g. flour -> sugar, both
  // mass) — the number is still meaningful. Across families (e.g. -> eggs
  // in pcs) the old unit no longer makes sense, so reset to the new
  // ingredient's base unit and clear the quantity rather than leave a
  // number that now silently means something else.
  function updateRowIngredient(index: number, ingredientProductId: string) {
    const newProduct = ingredientOptions.find((p) => p.id === ingredientProductId);
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index || !newProduct) return r;
        const compatible = getCompatibleUnits(newProduct.unit).includes(r.unit);
        return compatible
          ? { ...r, ingredientProductId }
          : { ...r, ingredientProductId, unit: newProduct.unit, quantity: "" };
      }),
    );
  }

  // Re-expresses the currently typed number in the new unit (4.75 кг -> 4750
  // г) instead of silently relabeling it — the quantity keeps meaning the
  // same real amount.
  function updateRowUnit(index: number, unit: Unit) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index || r.unit === unit) return r;
        const numeric = Number(r.quantity);
        const converted = r.quantity && !Number.isNaN(numeric) ? String(convertUnitQuantity(numeric, r.unit, unit)) : r.quantity;
        return { ...r, unit, quantity: converted };
      }),
    );
  }

  function addRow() {
    const first = ingredientOptions[0];
    setRows((prev) => [...prev, { ingredientProductId: first?.id ?? "", quantity: "", unit: first?.unit ?? Unit.KG }]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  // Dough weight computed the same way the server does, from the currently
  // typed ingredient rows — used for the live % hint per ingredient. Only
  // rows in a weight-compatible unit contribute (matches server logic).
  const KG_FACTOR: Partial<Record<Unit, number>> = { [Unit.KG]: 1, [Unit.G]: 0.001, [Unit.L]: 1, [Unit.ML]: 0.001 };
  const rowWeightsKg = rows.map((r) => {
    const factor = KG_FACTOR[r.unit];
    const n = Number(r.quantity);
    return factor !== undefined && !Number.isNaN(n) ? n * factor : null;
  });
  const liveDoughWeightKg = rowWeightsKg.some((w) => w !== null)
    ? rowWeightsKg.reduce((sum: number, w) => sum + (w ?? 0), 0)
    : null;

  // Economics recomputed live from the form's current state (not the last
  // saved values) — so editing ingredients, yield or losses updates cost and
  // margin immediately instead of only after saving and reopening.
  const liveTotalIngredientCost = rows.reduce((sum, row) => {
    const product = ingredientOptions.find((p) => p.id === row.ingredientProductId);
    const qty = Number(row.quantity);
    if (!product || Number.isNaN(qty)) return sum;
    return sum + convertUnitQuantity(qty, row.unit, product.unit) * product.price;
  }, 0);
  const liveYieldQuantity = Number(yieldQuantity) || 0;
  const liveLossPercent = Number(lossPercent) || 0;
  const liveEffectiveYield = liveYieldQuantity * (1 - liveLossPercent / 100);
  const liveUnitCost = liveEffectiveYield > 0 ? liveTotalIngredientCost / liveEffectiveYield : 0;
  const liveProductPrice = products.find((p) => p.id === productId)?.price ?? 0;
  const liveMarginPercent = liveProductPrice > 0 ? ((liveProductPrice - liveUnitCost) / liveProductPrice) * 100 : null;

  function addStage() {
    setStages((prev) => [...prev, { stageTypeId: stageTypes[0]?.id ?? "", note: "", parameters: [] }]);
  }

  function removeStage(index: number) {
    setStages((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStage(index: number, direction: -1 | 1) {
    setStages((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateStage(index: number, patch: Partial<StageRow>) {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function handleStageTypeSelect(index: number, value: string) {
    if (value !== NEW_STAGE_TYPE_VALUE) {
      updateStage(index, { stageTypeId: value });
      return;
    }
    updateStage(index, { isCreatingStageType: true, newStageTypeName: "" });
  }

  function cancelNewStageType(index: number) {
    updateStage(index, { isCreatingStageType: false, newStageTypeName: "" });
  }

  async function confirmNewStageType(index: number) {
    const name = stages[index]?.newStageTypeName?.trim();
    if (!name) return;
    try {
      const created = await api.recipeStageTypes.create({ name });
      setStageTypes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      updateStage(index, { stageTypeId: created.id, isCreatingStageType: false, newStageTypeName: "" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать стадию");
    }
  }

  function addParameter(stageIndex: number) {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIndex
          ? { ...s, parameters: [...s.parameters, { kind: RecipeParameterKind.DURATION_MINUTES, label: "", value: "" }] }
          : s,
      ),
    );
  }

  function updateParameter(stageIndex: number, paramIndex: number, patch: Partial<ParameterRow>) {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIndex
          ? { ...s, parameters: s.parameters.map((p, pi) => (pi === paramIndex ? { ...p, ...patch } : p)) }
          : s,
      ),
    );
  }

  function removeParameter(stageIndex: number, paramIndex: number) {
    setStages((prev) =>
      prev.map((s, i) => (i === stageIndex ? { ...s, parameters: s.parameters.filter((_, pi) => pi !== paramIndex) } : s)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const items = rows.map((r) => {
        const baseUnit = ingredientOptions.find((p) => p.id === r.ingredientProductId)?.unit ?? r.unit;
        return {
          ingredientProductId: r.ingredientProductId,
          quantity: convertUnitQuantity(Number(r.quantity), r.unit, baseUnit),
        };
      });

      const stagesPayload = stages
        .filter((s) => s.note.trim().length > 0 || s.parameters.some((p) => p.value !== ""))
        .map((s, index) => ({
          stageTypeId: s.stageTypeId,
          sequence: index + 1,
          note: s.note.trim() || undefined,
          parameters: s.parameters
            .filter((p) => p.value !== "")
            .map((p) => ({ kind: p.kind, label: p.label.trim() || undefined, value: Number(p.value) })),
        }));

      const techCardFields = {
        generalNotes: generalNotes || undefined,
        pieceWeightG: pieceWeightG ? Number(pieceWeightG) : undefined,
        lossPercent: lossPercent ? Number(lossPercent) : undefined,
        shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : undefined,
        stages: stagesPayload,
      };

      if (recipe) {
        await api.recipes.update(recipe.id, {
          yieldQuantity: Number(yieldQuantity),
          items,
          ...techCardFields,
        });
      } else {
        await api.recipes.create({
          productId,
          yieldQuantity: Number(yieldQuantity),
          items,
          ...techCardFields,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить техкарту");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!recipe && outputOptions.length === 0) {
    return (
      <Modal title="Новая рецептура" onClose={onClose}>
        <p className="text-sm text-muted">
          У всех товаров типа «Готовая продукция» уже есть рецептура. Добавьте новый товар в
          номенклатуре на странице «Склад», чтобы создать для него рецептуру.
        </p>
      </Modal>
    );
  }

  if (ingredientOptions.length === 0) {
    return (
      <Modal title="Новая рецептура" onClose={onClose}>
        <p className="text-sm text-muted">
          В номенклатуре нет товаров типа «Сырьё». Добавьте сырьё на странице «Склад», чтобы
          использовать его в рецептуре.
        </p>
      </Modal>
    );
  }

  const preBakeWeightG = recipe?.preBakeWeightG ?? null;
  const bakeLossG = preBakeWeightG !== null && pieceWeightG ? preBakeWeightG - Number(pieceWeightG) : null;

  return (
    <Modal
      title={recipe ? `Техкарта: ${recipe.productName}` : duplicateFrom ? `Копия рецептуры: ${duplicateFrom.productName}` : "Новая рецептура"}
      onClose={onClose}
      width="max-w-3xl"
    >
      <form onSubmit={handleSubmit}>
        <SectionTitle>Общая информация</SectionTitle>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Готовый товар</label>
            {recipe ? (
              <p className="rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-muted">
                {recipe.productName}
              </p>
            ) : (
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
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Вес одного готового изделия, г <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="напр. 150"
              value={pieceWeightG}
              onChange={(e) => setPieceWeightG(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {bakeLossG !== null && (
              <p className="mt-1.5 text-xs text-muted">
                Заготовка {preBakeWeightG} г → изделие {pieceWeightG} г: потери{" "}
                {bakeLossG >= 0 ? `${bakeLossG.toFixed(0)} г (${((bakeLossG / preBakeWeightG!) * 100).toFixed(0)}%)` : "—"}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Выход с одного замеса, шт</label>
            <input
              type="number"
              min="0"
              step="any"
              required
              placeholder="Сколько штук получается"
              value={yieldQuantity}
              onChange={(e) => setYieldQuantity(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Общее описание <span className="text-muted">(необязательно)</span>
          </label>
          <textarea
            value={generalNotes}
            onChange={(e) => setGeneralNotes(e.target.value)}
            rows={2}
            placeholder="Краткое описание изделия, особенности…"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <SectionTitle>Ингредиенты</SectionTitle>
        <p className="mb-2 text-xs text-muted">
          Количество указывается на весь замес целиком — тот самый, что даёт «Выход с одного замеса» готовых
          изделий выше, а не на одно изделие.
        </p>
        <div className="mb-3 space-y-2">
          {rows.map((row, index) => {
            const ingredientUnit = ingredientOptions.find((p) => p.id === row.ingredientProductId)?.unit;
            const compatibleUnits = ingredientUnit ? getCompatibleUnits(ingredientUnit) : [];
            const weightKg = rowWeightsKg[index];
            const percent = liveDoughWeightKg && weightKg !== null ? (weightKg / liveDoughWeightKg) * 100 : null;
            return (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={row.ingredientProductId}
                  onChange={(e) => updateRowIngredient(index, e.target.value)}
                  className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  {ingredientOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({UNIT_LABELS_RU[p.unit]})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={row.quantity}
                  onChange={(e) => updateRow(index, { quantity: e.target.value })}
                  className="w-24 shrink-0 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  placeholder="Кол-во"
                />
                {compatibleUnits.length > 1 ? (
                  <select
                    value={row.unit}
                    onChange={(e) => updateRowUnit(index, e.target.value as Unit)}
                    className="w-20 shrink-0 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  >
                    {compatibleUnits.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABELS_RU[u]}
                      </option>
                    ))}
                  </select>
                ) : (
                  ingredientUnit && (
                    <span className="w-20 shrink-0 text-center text-xs text-muted">{UNIT_LABELS_RU[ingredientUnit]}</span>
                  )
                )}
                <span className="w-12 shrink-0 text-right text-xs text-muted">
                  {percent !== null ? `${percent.toFixed(0)}%` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            );
          })}
        </div>
        {(liveDoughWeightKg !== null || rows.length > 0) && (
          <p className="mb-3 text-xs text-muted">
            Вес теста на замес:{" "}
            <span className="font-medium text-foreground">
              {liveDoughWeightKg !== null ? `≈ ${liveDoughWeightKg.toFixed(2)} кг` : "не рассчитан"}
            </span>
          </p>
        )}
        <button
          type="button"
          onClick={addRow}
          className="mb-5 flex items-center gap-1.5 text-sm font-medium text-accent hover:opacity-80"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Добавить ингредиент
        </button>

        <SectionTitle>Технологический процесс</SectionTitle>
        <p className="mb-2 text-xs text-muted">
          Стадии идут в том порядке, в котором вы их добавляете — как в бумажной техкарте. У каждой стадии
          можно указать структурные параметры (температура, время и т.д.) и/или свободную заметку.
        </p>
        <div className="mb-3 space-y-3">
          {stages.map((stage, stageIndex) => (
            <div key={stageIndex} className="rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                {stage.isCreatingStageType ? (
                  <>
                    <input
                      type="text"
                      autoFocus
                      value={stage.newStageTypeName ?? ""}
                      onChange={(e) => updateStage(stageIndex, { newStageTypeName: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmNewStageType(stageIndex);
                        }
                      }}
                      placeholder="Название новой стадии, например «Ламинирование»"
                      className="flex-1 rounded-xl border border-accent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent/20"
                    />
                    <button
                      type="button"
                      onClick={() => confirmNewStageType(stageIndex)}
                      className="shrink-0 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
                    >
                      Добавить
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelNewStageType(stageIndex)}
                      className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm text-muted transition hover:bg-surface-muted"
                    >
                      Отмена
                    </button>
                  </>
                ) : (
                  <select
                    value={stage.stageTypeId}
                    onChange={(e) => handleStageTypeSelect(stageIndex, e.target.value)}
                    className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  >
                    {stageTypes.length === 0 && <option value="">Стадий пока нет</option>}
                    {stageTypes.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                    <option value={NEW_STAGE_TYPE_VALUE}>+ Новая стадия…</option>
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => moveStage(stageIndex, -1)}
                  disabled={stageIndex === 0}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => moveStage(stageIndex, 1)}
                  disabled={stageIndex === stages.length - 1}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => removeStage(stageIndex)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>

              {stage.parameters.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {stage.parameters.map((param, paramIndex) => (
                    <div key={paramIndex} className="flex items-center gap-2">
                      <select
                        value={param.kind}
                        onChange={(e) => updateParameter(stageIndex, paramIndex, { kind: e.target.value as RecipeParameterKind })}
                        className="w-40 shrink-0 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      >
                        {Object.values(RecipeParameterKind).map((k) => (
                          <option key={k} value={k}>
                            {RECIPE_PARAMETER_KIND_LABELS_RU[k]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={param.label}
                        onChange={(e) => updateParameter(stageIndex, paramIndex, { label: e.target.value })}
                        placeholder="Уточнение (необязательно)"
                        className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      />
                      <input
                        type="number"
                        step="any"
                        value={param.value}
                        onChange={(e) => updateParameter(stageIndex, paramIndex, { value: e.target.value })}
                        className="w-24 shrink-0 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                        placeholder={RECIPE_PARAMETER_KIND_UNIT_RU[param.kind]}
                      />
                      <span className="w-8 shrink-0 text-xs text-muted">{RECIPE_PARAMETER_KIND_UNIT_RU[param.kind]}</span>
                      <button
                        type="button"
                        onClick={() => removeParameter(stageIndex, paramIndex)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => addParameter(stageIndex)}
                className="mb-2 flex items-center gap-1.5 text-xs font-medium text-accent hover:opacity-80"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Добавить параметр
              </button>

              <textarea
                value={stage.note}
                onChange={(e) => updateStage(stageIndex, { note: e.target.value })}
                rows={2}
                placeholder="Заметка к этой стадии (необязательно)"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          ))}
          {stages.length === 0 && <p className="text-sm text-muted">Стадий пока нет — можно добавить позже.</p>}
        </div>
        <button
          type="button"
          onClick={addStage}
          className="mb-5 flex items-center gap-1.5 text-sm font-medium text-accent hover:opacity-80"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Добавить стадию
        </button>

        <SectionTitle>Потери и срок годности</SectionTitle>
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div>
            <NumberField label="Производственные потери, %" value={lossPercent} onChange={setLossPercent} max="100" />
            <p className="mt-1.5 text-xs text-muted">
              Применяется к количеству готовых изделий при расчёте себестоимости — не к весу теста.
            </p>
          </div>
          <NumberField label="Срок годности, дней" value={shelfLifeDays} onChange={setShelfLifeDays} />
        </div>

        <SectionTitle>Экономика</SectionTitle>
        <p className="mb-2 text-xs text-muted">
          Пересчитывается сразу при изменении ингредиентов, выхода или потерь — ещё до сохранения.
        </p>
        <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Себестоимость замеса</p>
            <p className="font-medium text-foreground">{formatMoney(liveTotalIngredientCost)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Себестоимость одного изделия</p>
            <p className="font-medium text-foreground">{formatMoneyPrecise(liveUnitCost)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Цена продажи одного изделия</p>
            <p className="font-medium text-foreground">{formatMoney(liveProductPrice)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Маржа</p>
            <p className="font-medium text-foreground">
              {liveMarginPercent !== null ? `${liveMarginPercent.toFixed(0)}%` : "—"}
            </p>
          </div>
          {recipe && recipe.suggestedYieldQuantity != null && (
            <div className="col-span-2 border-t border-border pt-3 text-xs text-muted sm:col-span-4">
              Подсказка: при весе теста {recipe.doughWeightKg?.toFixed(2)} кг, изделии {recipe.pieceWeightG} г и
              потерях {recipe.lossPercent ?? 0}% примерный выход — {recipe.suggestedYieldQuantity} шт. Указанный
              выше «Выход с одного замеса» ({recipe.yieldQuantity} шт) при необходимости стоит скорректировать
              под факт.
            </div>
          )}
        </div>

        {recipe && recipe.revisions.length > 0 && (
          <>
            <SectionTitle>История изменений</SectionTitle>
            <ul className="mb-5 max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-surface-muted p-3">
              {recipe.revisions.map((rev) => (
                <li key={rev.id} className="text-sm">
                  <span className="text-muted">{formatDateTime(rev.changedAt)}</span>{" "}
                  <span className="text-foreground">{rev.summary}</span>{" "}
                  <span className="text-muted">— {rev.changedByName}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : recipe ? "Сохранить техкарту" : "Создать рецептуру"}
        </button>
      </form>
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-sm font-semibold text-foreground">{children}</p>;
}

function NumberField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      <input
        type="number"
        min="0"
        max={max}
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}
