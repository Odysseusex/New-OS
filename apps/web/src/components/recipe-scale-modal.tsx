"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Printer } from "lucide-react";
import type { RecipeBreakdownDto, RecipeDto } from "@bakery-os/shared";
import {
  ALL_FLOUR_KEY,
  defaultScaleBaseKey,
  factorForBase,
  factorForOutput,
  isFlourName,
  RECIPE_PARAMETER_KIND_LABELS_RU,
  RECIPE_PARAMETER_KIND_UNIT_RU,
  scaleBaseOptions,
  scaleRecipe,
  Unit,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { Modal } from "@/components/modal";
import { api, ApiError } from "@/lib/api";

type Mode = "output" | "base";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const nf = (value: number, digits: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);

const parse = (value: string) => Number(value.replace(",", "."));

// What a baker reads off the scales: grams / millilitres (one decimal under 10),
// pieces with the nearest whole number when the amount is fractional.
function formatAmount(quantity: number, unit: Unit): string {
  if (unit === Unit.KG || unit === Unit.G) {
    const g = unit === Unit.KG ? quantity * 1000 : quantity;
    return `${nf(g, g < 10 ? 1 : 0)} г`;
  }
  if (unit === Unit.L || unit === Unit.ML) {
    const ml = unit === Unit.L ? quantity * 1000 : quantity;
    return `${nf(ml, ml < 10 ? 1 : 0)} мл`;
  }
  const rounded = Math.round(quantity * 10) / 10;
  return Number.isInteger(rounded) ? `${nf(rounded, 0)} шт` : `${nf(rounded, 1)} шт (≈ ${Math.round(quantity)})`;
}

const formatOutput = (quantity: number, unit: Unit) => `${nf(quantity, unit === Unit.PCS ? 1 : 3)} ${UNIT_LABELS_RU[unit]}`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function RecipeScaleModal({
  recipe,
  initialQuantity,
  onClose,
}: {
  recipe: RecipeDto;
  // A production task's planned quantity; otherwise the recipe's own yield.
  initialQuantity?: number;
  onClose: () => void;
}) {
  const [breakdown, setBreakdown] = useState<RecipeBreakdownDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("output");
  const [outputQuantity, setOutputQuantity] = useState(String(initialQuantity ?? recipe.yieldQuantity));
  const [baseKey, setBaseKey] = useState<string | null>(null);
  const [baseKg, setBaseKg] = useState("");
  const [capacityKg, setCapacityKg] = useState(recipe.mixCapacityKg !== null ? String(recipe.mixCapacityKg) : "");

  useEffect(() => {
    let cancelled = false;
    api.recipes
      .breakdown(recipe.id)
      .then((data) => {
        if (cancelled) return;
        setBreakdown(data);
        setBaseKey(defaultScaleBaseKey(data.lines));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить техкарту");
      });
    return () => {
      cancelled = true;
    };
  }, [recipe.id]);

  const baseOptions = useMemo(() => (breakdown ? scaleBaseOptions(breakdown.lines) : []), [breakdown]);
  const base = baseOptions.find((o) => o.key === baseKey) ?? null;
  const baseIsFlour = base !== null && (base.key === ALL_FLOUR_KEY || isFlourName(base.label));

  const scaled = useMemo(() => {
    if (!breakdown) return null;
    const factor =
      mode === "output"
        ? factorForOutput(parse(outputQuantity), breakdown.yieldQuantity)
        : baseKey
          ? factorForBase(breakdown.lines, baseKey, parse(baseKg))
          : 0;
    const capacity = parse(capacityKg);
    return scaleRecipe(breakdown, factor, baseKey, capacity > 0 ? capacity : null);
  }, [breakdown, mode, outputQuantity, baseKey, baseKg, capacityKg]);

  const percentHeader = baseIsFlour ? "% к муке" : base ? `% к «${base.label}»` : null;

  function switchMode(next: Mode) {
    // Carry the current amount over so the list does not jump.
    if (next === "base" && scaled && base && !baseKg) setBaseKg(String(Math.round(base.massKg * scaled.factor * 1000) / 1000));
    if (next === "output" && scaled && scaled.factor > 0) setOutputQuantity(String(Math.round(scaled.outputQuantity * 1000) / 1000));
    setMode(next);
  }

  function handlePrint() {
    if (!breakdown || !scaled) return;
    const showPerMix = scaled.mixes > 1;
    const rows = scaled.lines
      .map(
        (l) =>
          `<tr><td>${escapeHtml(l.name)}${l.fromStock ? " (со склада)" : ""}</td><td class="n">${escapeHtml(formatAmount(l.scaled, l.unit))}</td>${
            percentHeader ? `<td class="n">${l.bakersPercent !== null ? nf(l.bakersPercent, 1) + "%" : ""}</td>` : ""
          }${showPerMix ? `<td class="n">${l.perMix !== null ? escapeHtml(formatAmount(l.perMix, l.unit)) : ""}</td>` : ""}</tr>`,
      )
      .join("");
    const stages = recipe.stages
      .map(
        (s) =>
          `<li><b>${escapeHtml(s.stageTypeName)}</b>${s.parameters
            .map((p) => ` · ${escapeHtml(p.label ?? RECIPE_PARAMETER_KIND_LABELS_RU[p.kind].split(",")[0])}: ${nf(p.value, 2)} ${RECIPE_PARAMETER_KIND_UNIT_RU[p.kind]}`)
            .join("")}${s.note ? ` — ${escapeHtml(s.note)}` : ""}</li>`,
      )
      .join("");
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(breakdown.productName)}</title>
<style>body{font-family:Arial,sans-serif;font-size:14px;margin:24px;color:#000}h1{font-size:20px;margin:0 0 4px}p{margin:2px 0}
table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee}.n{text-align:right;white-space:nowrap}
ul{padding-left:18px}.warn{margin-top:8px}</style></head><body>
<h1>${escapeHtml(breakdown.productName)} — ${escapeHtml(formatOutput(scaled.outputQuantity, breakdown.productUnit))}</h1>
<p>Масса замеса: ${nf(scaled.totalMassKg, 2)} кг${showPerMix ? ` · Замесов: ${scaled.mixes} по ${nf(scaled.perMixKg ?? 0, 2)} кг` : ""}</p>
<p>${escapeHtml(new Date().toLocaleString("ru-RU"))}</p>
<table><thead><tr><th>Ингредиент</th><th class="n">Количество</th>${percentHeader ? `<th class="n">${escapeHtml(percentHeader)}</th>` : ""}${
      showPerMix ? `<th class="n">На 1 замес</th>` : ""
    }</tr></thead><tbody>${rows}</tbody></table>
${breakdown.missing.length > 0 ? `<p class="warn">Не разложено (нет активной техкарты): ${escapeHtml(breakdown.missing.join(", "))}</p>` : ""}
${stages ? `<h2 style="font-size:16px;margin-top:16px">Технология</h2><ul>${stages}</ul>` : ""}
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <Modal title={`Расчёт: ${recipe.productName}`} onClose={onClose} width="max-w-2xl">
      {loadError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
      {!loadError && !breakdown && <p className="py-6 text-center text-sm text-muted">Загрузка…</p>}

      {breakdown && scaled && (
        <>
          <div className="mb-4 flex items-center gap-1 rounded-xl bg-surface-muted p-1 text-sm">
            {(
              [
                ["output", "По количеству"],
                ["base", "По весу"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => switchMode(key)}
                disabled={key === "base" && baseOptions.length === 0}
                className={clsx(
                  "flex-1 rounded-lg px-3 py-1.5 font-medium transition disabled:opacity-40",
                  mode === key ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {mode === "output" ? (
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  Количество, {UNIT_LABELS_RU[breakdown.productUnit]}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  autoFocus
                  value={outputQuantity}
                  onChange={(e) => setOutputQuantity(e.target.value)}
                  className={inputClass}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">База</label>
                  <select value={baseKey ?? ""} onChange={(e) => setBaseKey(e.target.value)} className={inputClass}>
                    {baseOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Вес, кг</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    autoFocus
                    value={baseKg}
                    onChange={(e) => setBaseKg(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Вместимость замеса, кг</label>
              <input
                type="number"
                min="0"
                step="any"
                value={capacityKg}
                onChange={(e) => setCapacityKg(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3 rounded-xl bg-surface-muted p-3 text-sm">
            <div>
              <p className="text-xs text-muted">Выход</p>
              <p className="font-semibold text-foreground">{formatOutput(scaled.outputQuantity, breakdown.productUnit)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Масса замеса</p>
              <p className="font-semibold text-foreground">{nf(scaled.totalMassKg, 2)} кг</p>
            </div>
            <div>
              <p className="text-xs text-muted">Замесов</p>
              <p className="font-semibold text-foreground">
                {scaled.mixes > 1 ? `${scaled.mixes} по ${nf(scaled.perMixKg ?? 0, 2)} кг` : "1"}
              </p>
            </div>
          </div>

          <table className="mb-3 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Ингредиент</th>
                <th className="py-2 pr-3 text-right font-medium">Количество</th>
                {percentHeader && <th className="py-2 pr-3 text-right font-medium">{percentHeader}</th>}
                {scaled.mixes > 1 && <th className="py-2 text-right font-medium">На 1 замес</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scaled.lines.map((line) => (
                <tr key={line.productId}>
                  <td className="py-2 pr-3 text-foreground">
                    {line.name}
                    {line.fromStock && <span className="ml-1.5 text-xs text-muted">со склада</span>}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium text-foreground">{formatAmount(line.scaled, line.unit)}</td>
                  {percentHeader && (
                    <td className="py-2 pr-3 text-right text-muted">
                      {line.bakersPercent !== null ? `${nf(line.bakersPercent, 1)}%` : "—"}
                    </td>
                  )}
                  {scaled.mixes > 1 && (
                    <td className="py-2 text-right text-foreground">{line.perMix !== null ? formatAmount(line.perMix, line.unit) : "—"}</td>
                  )}
                </tr>
              ))}
              {scaled.lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted">
                    В техкарте нет ингредиентов
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {breakdown.missing.length > 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              Не разложено (нет активной техкарты): {breakdown.missing.join(", ")}
            </p>
          )}
          {scaled.excludedFromMass.length > 0 && (
            <p className="mb-2 text-xs text-muted">Не входит в массу замеса: {scaled.excludedFromMass.join(", ")}</p>
          )}

          {recipe.stages.length > 0 && (
            <div className="mb-2 mt-4">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Технология</p>
              <ol className="space-y-1 text-sm">
                {recipe.stages.map((stage, index) => (
                  <li key={stage.id} className="text-foreground">
                    <span className="text-muted">{index + 1}.</span> <span className="font-medium">{stage.stageTypeName}</span>
                    {stage.parameters.map((p) => (
                      <span key={p.id} className="text-muted">
                        {" · "}
                        {p.label ?? RECIPE_PARAMETER_KIND_LABELS_RU[p.kind].split(",")[0]}: {nf(p.value, 2)}{" "}
                        {RECIPE_PARAMETER_KIND_UNIT_RU[p.kind]}
                      </span>
                    ))}
                    {stage.note && <span className="text-muted"> — {stage.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={scaled.factor === 0}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
            >
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Печать
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              Закрыть
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
