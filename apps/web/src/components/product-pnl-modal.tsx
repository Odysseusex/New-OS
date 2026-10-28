"use client";

import { useEffect, useState } from "react";
import type { ProductCostSourceKey, ProductPnLDetailDto, RecipeDto } from "@bakery-os/shared";
import { COST_BASIS_LABELS_RU, CostBasis, PRODUCT_COST_SOURCE_LABELS_RU, UNIT_LABELS_RU } from "@bakery-os/shared";
import { Modal } from "@/components/modal";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatMoneyPrecise, formatQuantity } from "@/lib/format";

function sourceLabel(source: ProductCostSourceKey): string {
  return source in COST_BASIS_LABELS_RU ? COST_BASIS_LABELS_RU[source as CostBasis] : PRODUCT_COST_SOURCE_LABELS_RU[source as "CURRENT" | "NONE" | "STAMPED"];
}

const percent = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/40 px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={tone === "warn" ? "mt-0.5 font-semibold text-amber-600" : "mt-0.5 font-semibold text-foreground"}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-border">{children}</div>
    </div>
  );
}

const th = "px-3 py-2 font-medium";
const td = "px-3 py-2";

// One row of «Финансовый результат по товарам», opened up for the same period
// and location as the report it was clicked in.
export function ProductPnlModal({
  productId,
  productName,
  from,
  to,
  locationId,
  onClose,
}: {
  productId: string;
  productName: string;
  from: string;
  to: string;
  locationId?: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ProductPnLDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<RecipeDto | null>(null);
  const [recipeError, setRecipeError] = useState<string | null>(null);

  useEffect(() => {
    api.finance
      .productPnl(productId, from, to, locationId)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить данные"));
    api.recipes
      .list()
      .then((list) => setRecipe(list.find((r) => r.productId === productId && r.isActive) ?? null))
      .catch((err) => setRecipeError(err instanceof ApiError ? err.message : "Не удалось загрузить техкарту"));
  }, [productId, from, to, locationId]);

  const unit = detail ? UNIT_LABELS_RU[detail.unit] : "";

  return (
    <Modal title={productName} onClose={onClose} width="max-w-4xl">
      <div className="-mt-3 mb-4 text-xs text-muted">
        {formatDate(from)} — {formatDate(to)}
      </div>
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!error && !detail && <div className="py-8 text-center text-sm text-muted">Загрузка…</div>}
      {detail && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Продано" value={`${formatQuantity(detail.quantitySold)} ${unit}`} />
            <Stat label="Выручка" value={formatMoney(detail.revenue)} />
            <Stat label="Себестоимость" value={detail.hasCostData ? formatMoney(detail.cogs) : "—"} tone={detail.hasCostData ? undefined : "warn"} />
            <Stat label="Валовая прибыль" value={formatMoney(detail.grossProfit)} />
            <Stat label="Маржинальность" value={percent(detail.marginPercent)} />
            <Stat label="Средняя цена" value={detail.averagePrice === null ? "—" : formatMoneyPrecise(detail.averagePrice)} />
            <Stat
              label="Себестоимость единицы (средняя)"
              value={detail.averageUnitCost === null ? "—" : formatMoneyPrecise(detail.averageUnitCost)}
            />
            <Stat
              label="Себестоимость единицы (текущая)"
              value={detail.currentUnitCost === null ? "Не рассчитана" : formatMoneyPrecise(detail.currentUnitCost)}
              tone={detail.currentUnitCost === null ? "warn" : undefined}
            />
          </div>
          {(detail.returnsQuantity > 0 || detail.discounts > 0) && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {detail.returnsQuantity > 0 && (
                <>
                  <Stat label="Продажи" value={`${formatQuantity(detail.salesQuantity)} ${unit} · ${formatMoney(detail.salesRevenue)}`} />
                  <Stat label="Возвраты" value={`${formatQuantity(detail.returnsQuantity)} ${unit} · ${formatMoney(detail.returnsRevenue)}`} />
                  <Stat label="Себестоимость возвратов" value={formatMoney(detail.returnsCogs)} />
                </>
              )}
              {detail.discounts > 0 && <Stat label="Скидки" value={formatMoney(detail.discounts)} />}
            </div>
          )}

          <Section title="Источник себестоимости">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className={th}>Источник</th>
                  <th className={`${th} text-right`}>Продано</th>
                  <th className={`${th} text-right`}>Себестоимость</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.costSources.map((s) => (
                  <tr key={s.source}>
                    <td className={s.source === "NONE" || s.source === "CURRENT" ? `${td} text-amber-600` : `${td} text-foreground`}>
                      {sourceLabel(s.source)}
                    </td>
                    <td className={`${td} text-right text-muted`}>
                      {formatQuantity(s.quantity)} {unit}
                    </td>
                    <td className={`${td} text-right text-foreground`}>{s.source === "NONE" ? "—" : formatMoney(s.cogs)}</td>
                  </tr>
                ))}
                {detail.costSources.length === 0 && (
                  <tr>
                    <td colSpan={3} className={`${td} text-center text-muted`}>
                      Продаж за этот период нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Section>

          {detail.unitCosts.length > 0 && (
            <Section title="Себестоимость единицы в продажах">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className={th}>Себестоимость единицы</th>
                    <th className={`${th} text-right`}>Продано</th>
                    <th className={`${th} text-right`}>Период продаж</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.unitCosts.map((u) => (
                    <tr key={`${u.unitCost}-${u.firstAt}`}>
                      <td className={u.unitCost === null ? `${td} text-amber-600` : `${td} text-foreground`}>
                        {u.unitCost === null ? "Неизвестна" : formatMoneyPrecise(u.unitCost)}
                      </td>
                      <td className={`${td} text-right text-muted`}>
                        {formatQuantity(u.quantity)} {unit}
                      </td>
                      <td className={`${td} text-right text-muted`}>
                        {formatDate(u.firstAt) === formatDate(u.lastAt) ? formatDate(u.firstAt) : `${formatDate(u.firstAt)} — ${formatDate(u.lastAt)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {detail.prices.length > 0 && (
            <Section title="Цены продажи">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className={th}>Цена</th>
                    <th className={`${th} text-right`}>Цена без скидки</th>
                    <th className={`${th} text-right`}>Продано</th>
                    <th className={`${th} text-right`}>Выручка</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.prices.map((p) => (
                    <tr key={`${p.unitPrice}-${p.fullUnitPrice}`}>
                      <td className={`${td} text-foreground`}>{formatMoneyPrecise(p.unitPrice)}</td>
                      <td className={`${td} text-right text-muted`}>{p.fullUnitPrice === null ? "—" : formatMoneyPrecise(p.fullUnitPrice)}</td>
                      <td className={`${td} text-right text-muted`}>
                        {formatQuantity(p.quantity)} {unit}
                      </td>
                      <td className={`${td} text-right text-foreground`}>{formatMoney(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {detail.byLocation.length > 0 && (
            <Section title="По точкам">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className={th}>Точка</th>
                    <th className={`${th} text-right`}>Продано</th>
                    <th className={`${th} text-right`}>Выручка</th>
                    <th className={`${th} text-right`}>Себестоимость</th>
                    <th className={`${th} text-right`}>Валовая прибыль</th>
                    <th className={`${th} text-right`}>Маржа</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.byLocation.map((l) => (
                    <tr key={l.locationId}>
                      <td className={`${td} text-foreground`}>{l.locationName}</td>
                      <td className={`${td} text-right text-muted`}>
                        {formatQuantity(l.quantity)} {unit}
                      </td>
                      <td className={`${td} text-right text-foreground`}>{formatMoney(l.revenue)}</td>
                      <td className={`${td} text-right text-muted`}>{l.hasCostData ? formatMoney(l.cogs) : "—"}</td>
                      <td className={`${td} text-right text-foreground`}>{formatMoney(l.revenue - l.cogs)}</td>
                      <td className={`${td} text-right text-muted`}>{l.revenue > 0 ? percent(((l.revenue - l.cogs) / l.revenue) * 100) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {recipeError && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{recipeError}</div>}
          {recipe && <RecipeCost recipe={recipe} />}
        </>
      )}
    </Modal>
  );
}

// The active техкарта as it prices one unit today.
function RecipeCost({ recipe }: { recipe: RecipeDto }) {
  const total = recipe.totalIngredientCost;
  return (
    <Section title={`Техкарта (текущая) · выход ${formatQuantity(recipe.yieldQuantity)} ${UNIT_LABELS_RU[recipe.productUnit]}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className={th}>Ингредиент</th>
            <th className={`${th} text-right`}>Количество</th>
            <th className={`${th} text-right`}>Цена за единицу</th>
            <th className={`${th} text-right`}>Стоимость</th>
            <th className={`${th} text-right`}>Доля</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {recipe.items.map((item) => {
            const cost = item.ingredientUnitCost === null ? null : item.quantity * item.ingredientUnitCost;
            return (
              <tr key={item.id}>
                <td className={`${td} text-foreground`}>{item.ingredientProductName}</td>
                <td className={`${td} text-right text-muted`}>
                  {formatQuantity(item.quantity)} {UNIT_LABELS_RU[item.unit]}
                </td>
                <td className={item.ingredientUnitCost === null ? `${td} text-right text-amber-600` : `${td} text-right text-muted`}>
                  {item.ingredientUnitCost === null ? "Нет цены" : `${formatMoneyPrecise(item.ingredientUnitCost)} / ${UNIT_LABELS_RU[item.unit]}`}
                </td>
                <td className={`${td} text-right text-foreground`}>{cost === null ? "—" : formatMoneyPrecise(cost)}</td>
                <td className={`${td} text-right text-muted`}>{cost === null || total <= 0 ? "—" : percent((cost / total) * 100)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-border">
          <tr>
            <td colSpan={3} className={`${td} text-muted`}>
              Стоимость ингредиентов на выход
            </td>
            <td className={`${td} text-right font-semibold text-foreground`}>{formatMoneyPrecise(total)}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={3} className={`${td} text-muted`}>
              Себестоимость единицы
            </td>
            <td className={`${td} text-right font-semibold text-foreground`}>{formatMoneyPrecise(recipe.unitCost)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {(!recipe.costComplete || recipe.uncountedWarning) && (
        <div className="border-t border-border bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {!recipe.costComplete && <div>Не все ингредиенты имеют цену — себестоимость занижена.</div>}
          {recipe.uncountedWarning && <div>{recipe.uncountedWarning}</div>}
        </div>
      )}
    </Section>
  );
}
