"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { LocationDto, ProductDto, ProductionReleasePreviewDto, ProductionReleaseRequestDto, RecipeDto } from "@bakery-os/shared";
import { PRODUCTION_RELEASE_MAX_LINES, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { enterNext, withTrailingRow } from "@/lib/keyboard";
import { formatMoney, formatQuantity } from "@/lib/format";

type Row = { key: number; productId: string; quantity: string };
let nextKey = 1;
const newRow = (): Row => ({ key: nextKey++, productId: "", quantity: "" });
const parse = (s: string) => Number(s.trim().replace(",", "."));

// «Выпуск за день»: what the bakers made, typed in one go → «Проверить» shows the raw materials that
// will be written off and what is missing → «Провести выпуск» = every line produced at once.
export function ProductionReleaseModal({
  locations,
  products,
  recipes,
  fixedLocationId,
  onClose,
  onDone,
}: {
  locations: LocationDto[];
  products: ProductDto[];
  recipes: RecipeDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // The workshops; an organization with none marked as a workshop picks from all its points.
  const bakeries = locations.filter((l) => l.type === "BAKERY_PRODUCTION" || l.id === fixedLocationId);
  const workshops = bakeries.length > 0 ? bakeries : locations.filter((l) => l.isActive !== false);
  const [locationId, setLocationId] = useState(fixedLocationId ?? "");
  const [outputLocationId, setOutputLocationId] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [preview, setPreview] = useState<ProductionReleasePreviewDto | null>(null);
  // Raw material really used, for the whole release; empty = the norm.
  const [used, setUsed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The workshop list may arrive after the window opens.
  useEffect(() => {
    if (!locationId && workshops[0]) setLocationId(workshops[0].id);
  }, [locationId, workshops]);

  // What can be produced: products with an active recipe (a filling only when it is held as stock).
  const producible = useMemo(() => {
    const ids = new Set(recipes.filter((r) => r.isActive && (r.productType !== "SEMI_FINISHED" || r.productStocked)).map((r) => r.productId));
    return products.filter((p) => ids.has(p.id));
  }, [products, recipes]);

  const trailing = (list: Row[]) => withTrailingRow(list, (r) => !r.productId, newRow, PRODUCTION_RELEASE_MAX_LINES);
  const updateRow = (key: number, patch: Partial<Row>) => setRows((prev) => trailing(prev.map((r) => (r.key === key ? { ...r, ...patch } : r))));

  function request(): ProductionReleaseRequestDto | null {
    const filled = rows.filter((r) => r.productId || r.quantity.trim() !== "");
    if (filled.length === 0) return fail("Добавьте хотя бы один товар");
    if (filled.some((r) => !r.productId)) return fail("В одной из строк не выбран товар");
    if (filled.some((r) => !(parse(r.quantity) > 0))) return fail("Укажите количество больше нуля в каждой строке");
    if (new Set(filled.map((r) => r.productId)).size !== filled.length) return fail("Один и тот же товар указан дважды — объедините строки");
    return {
      locationId,
      outputLocationId: outputLocationId && outputLocationId !== locationId ? outputLocationId : undefined,
      lines: filled.map((r) => ({ productId: r.productId, quantity: parse(r.quantity) })),
    };
  }
  function fail(message: string): null {
    setError(message);
    return null;
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const dto = request();
    if (!dto) return;
    setBusy(true);
    try {
      setPreview(await api.production.previewRelease(dto));
      setUsed({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось проверить выпуск");
    } finally {
      setBusy(false);
    }
  }

  const materials = (preview?.materials ?? []).map((m) => {
    const typed = used[m.productId]?.trim() ?? "";
    const fact = typed === "" ? m.quantity : parse(typed);
    return { ...m, typed, fact, deviation: Number.isFinite(fact) ? Math.round((fact - m.quantity) * 1000) / 1000 : null };
  });
  const shortages = materials.filter((m) => m.shortage > 0);
  const blocked = shortages.length > 0 && !preview?.allowNegativeStock;

  async function submitRelease() {
    setError(null);
    const dto = request();
    if (!dto) return;
    if (materials.some((m) => m.typed !== "" && (m.deviation === null || m.fact < 0))) {
      setError("Проверьте фактический расход: нужно число не меньше нуля");
      return;
    }
    setBusy(true);
    try {
      const result = await api.production.release({
        ...dto,
        consumption: materials
          .filter((m) => m.typed !== "" && Math.abs(m.fact - m.quantity) >= 0.0005)
          .map((m) => ({ productId: m.productId, quantity: Math.round(m.fact * 1000) / 1000 })),
      });
      onDone(`Выпуск проведён: ${result.batchIds.length} поз., себестоимость ${formatMoney(result.totalCost)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести выпуск");
    } finally {
      setBusy(false);
    }
  }

  const unitOf = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    return p ? UNIT_LABELS_RU[p.unit] : "";
  };
  const select =
    "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

  if (preview) {
    const totalsByUnit = new Map<string, number>();
    for (const l of preview.lines) totalsByUnit.set(UNIT_LABELS_RU[l.unit], (totalsByUnit.get(UNIT_LABELS_RU[l.unit]) ?? 0) + l.quantity);
    return (
      <Modal title="Проверьте выпуск" onClose={onClose} width="max-w-3xl">
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>
            Проверьте ещё раз: {preview.lines.length} поз.,{" "}
            {Array.from(totalsByUnit).map(([unit, q]) => `${formatQuantity(q)} ${unit}`).join(" + ")}. После проведения сырьё спишется, а продукция
            встанет на остаток — исправить можно будет только корректировкой.
          </span>
        </div>

        <table className="mb-5 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">Продукция</th>
              <th className="py-2 text-right font-medium">Количество</th>
              <th className="py-2 text-right font-medium">Себестоимость</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {preview.lines.map((l) => (
              <tr key={l.productId}>
                <td className="py-2 text-foreground">{l.productName}</td>
                <td className="py-2 text-right font-medium text-foreground">
                  {formatQuantity(l.quantity)} {UNIT_LABELS_RU[l.unit]}
                </td>
                <td className="py-2 text-right text-muted">{formatMoney(l.cost)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 font-medium text-foreground">Итого</td>
              <td />
              <td className="py-2 text-right font-semibold text-foreground">{formatMoney(preview.totalCost)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mb-2 text-sm font-medium text-foreground">Будет списано сырья</p>
        <div className="mb-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Сырьё</th>
                <th className="px-3 py-2 text-right font-medium">Норма</th>
                <th className="px-3 py-2 text-right font-medium">На складе</th>
                <th className="px-3 py-2 text-right font-medium">Факт</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {materials.map((m) => (
                <tr key={m.productId} className={clsx(m.shortage > 0 && "bg-red-50")}>
                  <td className="px-3 py-2 text-foreground">
                    {m.name}
                    {m.fromStock && <span className="ml-1.5 text-xs text-muted">полуфабрикат</span>}
                    {m.shortage > 0 && (
                      <span className="ml-1.5 text-xs font-medium text-red-700">
                        не хватает {formatQuantity(m.shortage)} {UNIT_LABELS_RU[m.unit]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground">
                    {formatQuantity(m.quantity)} {UNIT_LABELS_RU[m.unit]}
                  </td>
                  <td className={clsx("px-3 py-2 text-right", m.shortage > 0 ? "text-red-700" : "text-muted")}>
                    {formatQuantity(m.onHand)} {UNIT_LABELS_RU[m.unit]}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      inputMode="decimal"
                      value={used[m.productId] ?? ""}
                      onChange={(e) => setUsed((cur) => ({ ...cur, [m.productId]: e.target.value }))}
                      placeholder={formatQuantity(m.quantity)}
                      aria-label={`Факт: ${m.name}`}
                      className="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    {m.typed !== "" && m.deviation !== null && m.deviation !== 0 && (
                      <p className={clsx("mt-0.5 text-xs", m.deviation > 0 ? "text-red-600" : "text-emerald-700")}>
                        {m.deviation > 0 ? "перерасход +" : "экономия −"}
                        {formatQuantity(Math.abs(m.deviation))}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mb-4 text-xs text-muted">«Факт» заполняйте, только если пекари взвесили расход и он отличается от нормы.</p>

        {blocked && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            Не хватает сырья на складе цеха: {shortages.map((m) => m.name).join(", ")}. Сначала оприходуйте его (Склад → Приёмка) или
            включите «Разрешить уход в минус».
          </div>
        )}
        {!blocked && shortages.length > 0 && (
          <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Сырья на складе меньше нормы — остаток уйдёт в минус (разрешено до инвентаризации).
          </div>
        )}
        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
          >
            Назад, исправить
          </button>
          <button
            type="button"
            data-submit
            onClick={submitRelease}
            disabled={busy || blocked}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Проводим…" : "Провести выпуск"}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Выпуск за день" onClose={onClose} width="max-w-2xl">
      <form onSubmit={check}>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Цех</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!!fixedLocationId} className={select}>
              {workshops.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Куда оприходовать</label>
            <select value={outputLocationId} onChange={(e) => setOutputLocationId(e.target.value)} className={select}>
              <option value="">На склад цеха</option>
              {locations
                .filter((l) => l.isActive !== false && l.id !== locationId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="mb-1.5 flex gap-2 text-xs text-muted">
          <span className="flex-1">Продукция</span>
          <span className="w-32">Вышло</span>
          <span className="w-8" />
        </div>
        <div className="mb-5 space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <ProductSelect
                products={producible}
                value={row.productId}
                onChange={(productId) => updateRow(row.key, { productId })}
                className="min-w-0 flex-1"
                enterFlow
              />
              <input
                {...enterNext}
                inputMode="decimal"
                value={row.quantity}
                onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                placeholder={unitOf(row.productId)}
                aria-label="Количество"
                className="w-32 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="button"
                onClick={() => setRows((prev) => trailing(prev.filter((r) => r.key !== row.key)))}
                title="Убрать строку"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>

        {producible.length === 0 && (
          <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">Нет продукции с действующей техкартой.</p>
        )}
        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={busy || !locationId}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Проверяем…" : "Проверить"}
        </button>
      </form>
    </Modal>
  );
}
