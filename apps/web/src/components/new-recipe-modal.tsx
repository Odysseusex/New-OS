"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ProductDto, RecipeDto } from "@bakery-os/shared";
import { ProductType, Unit, UNIT_LABELS_RU, convertUnitQuantity, getCompatibleUnits } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney } from "@/lib/format";

interface IngredientRow {
  ingredientProductId: string;
  quantity: string;
  // The unit this row's quantity is currently typed in — not necessarily
  // the ingredient's base/storage unit. Converted to base unit on submit.
  unit: Unit;
}

interface StepRow {
  instruction: string;
  durationMinutes: string;
}

export function NewRecipeModal({
  products,
  existingRecipeProductIds,
  recipe,
  onClose,
  onSaved,
}: {
  products: ProductDto[];
  existingRecipeProductIds: string[];
  recipe?: RecipeDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const outputOptions = products.filter(
    (p) => p.type === ProductType.FINISHED_GOOD && !existingRecipeProductIds.includes(p.id),
  );
  const ingredientOptions = products.filter((p) => p.type === ProductType.RAW_MATERIAL);

  const [productId, setProductId] = useState(recipe?.productId ?? outputOptions[0]?.id ?? "");
  const [yieldQuantity, setYieldQuantity] = useState(recipe ? String(recipe.yieldQuantity) : "");
  const [pieceWeightG, setPieceWeightG] = useState(
    recipe?.pieceWeightG !== null && recipe?.pieceWeightG !== undefined ? String(recipe.pieceWeightG) : "",
  );
  const [generalNotes, setGeneralNotes] = useState(recipe?.generalNotes ?? "");
  const [rows, setRows] = useState<IngredientRow[]>(
    recipe && recipe.items.length > 0
      ? recipe.items.map((i) => ({ ingredientProductId: i.ingredientProductId, quantity: String(i.quantity), unit: i.unit }))
      : [
          {
            ingredientProductId: ingredientOptions[0]?.id ?? "",
            quantity: "",
            unit: ingredientOptions[0]?.unit ?? Unit.KG,
          },
        ],
  );
  const [steps, setSteps] = useState<StepRow[]>(
    recipe?.steps.map((s) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes !== null ? String(s.durationMinutes) : "",
    })) ?? [],
  );
  const [mixingTimeSlowMinutes, setMixingTimeSlowMinutes] = useState(
    recipe?.mixingTimeSlowMinutes !== null && recipe?.mixingTimeSlowMinutes !== undefined ? String(recipe.mixingTimeSlowMinutes) : "",
  );
  const [mixingTimeFastMinutes, setMixingTimeFastMinutes] = useState(
    recipe?.mixingTimeFastMinutes !== null && recipe?.mixingTimeFastMinutes !== undefined ? String(recipe.mixingTimeFastMinutes) : "",
  );
  const [doughTempC, setDoughTempC] = useState(
    recipe?.doughTempC !== null && recipe?.doughTempC !== undefined ? String(recipe.doughTempC) : "",
  );
  const [shapingWeightG, setShapingWeightG] = useState(
    recipe?.shapingWeightG !== null && recipe?.shapingWeightG !== undefined ? String(recipe.shapingWeightG) : "",
  );
  const [proofingTempC, setProofingTempC] = useState(
    recipe?.proofingTempC !== null && recipe?.proofingTempC !== undefined ? String(recipe.proofingTempC) : "",
  );
  const [proofingHumidityPercent, setProofingHumidityPercent] = useState(
    recipe?.proofingHumidityPercent !== null && recipe?.proofingHumidityPercent !== undefined
      ? String(recipe.proofingHumidityPercent)
      : "",
  );
  const [bakingTempC, setBakingTempC] = useState(recipe?.bakingTempC !== null && recipe?.bakingTempC !== undefined ? String(recipe.bakingTempC) : "");
  const [bakingTimeMinutes, setBakingTimeMinutes] = useState(
    recipe?.bakingTimeMinutes !== null && recipe?.bakingTimeMinutes !== undefined ? String(recipe.bakingTimeMinutes) : "",
  );
  const [steamSeconds, setSteamSeconds] = useState(
    recipe?.steamSeconds !== null && recipe?.steamSeconds !== undefined ? String(recipe.steamSeconds) : "",
  );
  const [fermentationMinutes, setFermentationMinutes] = useState(
    recipe?.fermentationMinutes !== null && recipe?.fermentationMinutes !== undefined ? String(recipe.fermentationMinutes) : "",
  );
  const [proofingMinutes, setProofingMinutes] = useState(
    recipe?.proofingMinutes !== null && recipe?.proofingMinutes !== undefined ? String(recipe.proofingMinutes) : "",
  );
  const [lossPercent, setLossPercent] = useState(
    recipe?.lossPercent !== null && recipe?.lossPercent !== undefined ? String(recipe.lossPercent) : "",
  );
  const [shelfLifeDays, setShelfLifeDays] = useState(
    recipe?.shelfLifeDays !== null && recipe?.shelfLifeDays !== undefined ? String(recipe.shelfLifeDays) : "",
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

  function addStep() {
    setSteps((prev) => [...prev, { instruction: "", durationMinutes: "" }]);
  }

  function updateStep(index: number, patch: Partial<StepRow>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const techCardFields = {
        generalNotes: generalNotes || undefined,
        pieceWeightG: pieceWeightG ? Number(pieceWeightG) : undefined,
        mixingTimeSlowMinutes: mixingTimeSlowMinutes ? Number(mixingTimeSlowMinutes) : undefined,
        mixingTimeFastMinutes: mixingTimeFastMinutes ? Number(mixingTimeFastMinutes) : undefined,
        doughTempC: doughTempC ? Number(doughTempC) : undefined,
        shapingWeightG: shapingWeightG ? Number(shapingWeightG) : undefined,
        proofingTempC: proofingTempC ? Number(proofingTempC) : undefined,
        proofingHumidityPercent: proofingHumidityPercent ? Number(proofingHumidityPercent) : undefined,
        bakingTempC: bakingTempC ? Number(bakingTempC) : undefined,
        bakingTimeMinutes: bakingTimeMinutes ? Number(bakingTimeMinutes) : undefined,
        steamSeconds: steamSeconds ? Number(steamSeconds) : undefined,
        fermentationMinutes: fermentationMinutes ? Number(fermentationMinutes) : undefined,
        proofingMinutes: proofingMinutes ? Number(proofingMinutes) : undefined,
        lossPercent: lossPercent ? Number(lossPercent) : undefined,
        shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : undefined,
        steps: steps
          .filter((s) => s.instruction.trim().length > 0)
          .map((s, index) => ({
            sequence: index + 1,
            instruction: s.instruction,
            durationMinutes: s.durationMinutes ? Number(s.durationMinutes) : undefined,
          })),
      };
      const items = rows.map((r) => {
        const baseUnit = ingredientOptions.find((p) => p.id === r.ingredientProductId)?.unit ?? r.unit;
        return {
          ingredientProductId: r.ingredientProductId,
          quantity: convertUnitQuantity(Number(r.quantity), r.unit, baseUnit),
        };
      });

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

  return (
    <Modal title={recipe ? `Техкарта: ${recipe.productName}` : "Новая рецептура"} onClose={onClose} width="max-w-3xl">
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
        {recipe && (recipe.doughWeightKg !== null || recipe.doughWeightExcludedIngredients.length > 0) && (
          <p className="mb-3 text-xs text-muted">
            Вес теста на замес:{" "}
            <span className="font-medium text-foreground">
              {recipe.doughWeightKg !== null ? `≈ ${recipe.doughWeightKg.toFixed(2)} кг` : "не рассчитан"}
            </span>
            {recipe.doughWeightExcludedIngredients.length > 0 && (
              <> (без учёта: {recipe.doughWeightExcludedIngredients.join(", ")} — в штуках, вес неизвестен)</>
            )}
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

        <SectionTitle>Технология приготовления</SectionTitle>
        <div className="mb-3 space-y-2">
          {steps.map((step, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-2.5 w-5 shrink-0 text-sm font-medium text-muted">{index + 1}.</span>
              <input
                type="text"
                value={step.instruction}
                onChange={(e) => updateStep(index, { instruction: e.target.value })}
                placeholder="Что нужно сделать на этом шаге"
                className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <input
                type="number"
                min="0"
                value={step.durationMinutes}
                onChange={(e) => updateStep(index, { durationMinutes: e.target.value })}
                placeholder="Мин."
                className="w-20 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="button"
                onClick={() => moveStep(index, -1)}
                disabled={index === 0}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => moveStep(index, 1)}
                disabled={index === steps.length - 1}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted disabled:opacity-30"
              >
                <ArrowDown className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => removeStep(index)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ))}
          {steps.length === 0 && (
            <p className="text-sm text-muted">Шагов пока нет — можно добавить позже.</p>
          )}
        </div>
        <button
          type="button"
          onClick={addStep}
          className="mb-5 flex items-center gap-1.5 text-sm font-medium text-accent hover:opacity-80"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Добавить шаг
        </button>

        <SectionTitle>Параметры производства</SectionTitle>

        <StageTitle>Замес</StageTitle>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField label="Время замеса (медленно), мин" value={mixingTimeSlowMinutes} onChange={setMixingTimeSlowMinutes} />
          <NumberField label="Время замеса (быстро), мин" value={mixingTimeFastMinutes} onChange={setMixingTimeFastMinutes} />
          <NumberField label="Темп. теста после замеса, °C" value={doughTempC} onChange={setDoughTempC} />
        </div>

        <StageTitle>Брожение</StageTitle>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField label="Брожение, мин" value={fermentationMinutes} onChange={setFermentationMinutes} />
        </div>

        <StageTitle>Формовка</StageTitle>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField label="Вес заготовки, г" value={shapingWeightG} onChange={setShapingWeightG} />
        </div>

        <StageTitle>Расстойка</StageTitle>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField label="Расстойка, мин" value={proofingMinutes} onChange={setProofingMinutes} />
          <NumberField label="Температура расстойки, °C" value={proofingTempC} onChange={setProofingTempC} />
          <NumberField label="Влажность расстойки, %" value={proofingHumidityPercent} onChange={setProofingHumidityPercent} max="100" />
        </div>

        <StageTitle>Выпечка</StageTitle>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField label="Темп. выпечки, °C" value={bakingTempC} onChange={setBakingTempC} />
          <NumberField label="Время выпечки, мин" value={bakingTimeMinutes} onChange={setBakingTimeMinutes} />
          <NumberField label="Пар при посадке, сек" value={steamSeconds} onChange={setSteamSeconds} />
        </div>

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

        {recipe && (
          <>
            <SectionTitle>Экономика</SectionTitle>
            <div className="mb-5 grid grid-cols-3 gap-3 rounded-xl bg-surface-muted p-3 text-sm">
              <div>
                <p className="text-xs text-muted">Себестоимость</p>
                <p className="font-medium text-foreground">{formatMoney(recipe.unitCost)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Цена продажи</p>
                <p className="font-medium text-foreground">{formatMoney(recipe.productPrice)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Маржа</p>
                <p className="font-medium text-foreground">
                  {recipe.marginPercent !== null ? `${recipe.marginPercent.toFixed(0)}%` : "—"}
                </p>
              </div>
              {recipe.suggestedYieldQuantity !== null && (
                <div className="col-span-3 border-t border-border pt-3 text-xs text-muted">
                  Подсказка: при весе теста {recipe.doughWeightKg?.toFixed(2)} кг, изделии {recipe.pieceWeightG} г и
                  потерях {recipe.lossPercent ?? 0}% примерный выход — {recipe.suggestedYieldQuantity} шт. Указанный
                  выше «Выход с одного замеса» ({recipe.yieldQuantity} шт) при необходимости стоит скорректировать
                  под факт.
                </div>
              )}
            </div>

            {recipe.revisions.length > 0 && (
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

function StageTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{children}</p>;
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
