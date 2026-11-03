"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductionBatchDto, ProductionBatchNormDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatQuantity } from "@/lib/format";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function CompleteBatchModal({
  batch,
  onClose,
  onCompleted,
}: {
  batch: ProductionBatchDto;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [actualQuantity, setActualQuantity] = useState(String(batch.plannedQuantity));
  const [norm, setNorm] = useState<ProductionBatchNormDto | null>(null);
  const [normError, setNormError] = useState<string | null>(null);
  // What was really used, per ingredient; empty = exactly the norm.
  const [used, setUsed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.production
      .batchNorm(batch.id)
      .then(setNorm)
      .catch((err) => setNormError(err instanceof ApiError ? err.message : "Не удалось загрузить норму сырья"));
  }, [batch.id]);

  // The norm follows the output (or the plan, for a stocked semi-finished product).
  const consumeFor = batch.consumesByPlan ? batch.plannedQuantity : Number(actualQuantity) || 0;
  const rows = useMemo(
    () =>
      (norm?.lines ?? []).map((line) => {
        const normQty = round3(line.perUnit * consumeFor);
        const typed = used[line.productId]?.trim() ?? "";
        const fact = typed === "" ? normQty : Number(typed.replace(",", "."));
        return { line, normQty, typed, fact, deviation: Number.isFinite(fact) ? round3(fact - normQty) : null };
      }),
    [norm, consumeFor, used],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rows.some((r) => r.typed !== "" && (r.deviation === null || r.fact < 0))) {
      setError("Проверьте фактический расход: нужно число не меньше нуля");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.production.completeBatch(batch.id, {
        actualQuantity: Number(actualQuantity),
        // Only what differs from the norm is sent; the rest is consumed at the norm.
        consumption: rows
          .filter((r) => r.typed !== "" && Math.abs(r.fact - r.normQty) >= 0.0005)
          .map((r) => ({ productId: r.line.productId, quantity: round3(r.fact) })),
      });
      onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось завершить задание");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Завершить производственное задание" onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-muted">
          {batch.productName} · план {batch.plannedQuantity} {UNIT_LABELS_RU[batch.unit]}
        </p>
        {batch.consumesByPlan && (
          <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Сырьё спишется по плану ({batch.plannedQuantity} {UNIT_LABELS_RU[batch.unit]}). Введите вес, который вышел на самом деле: от него зависит цена за единицу и остаток на складе.
          </p>
        )}

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {batch.consumesByPlan ? "Фактический выход" : "Фактически произведено"}
          </label>
          <input
            type="number"
            min="0"
            step="any"
            required
            autoFocus
            value={actualQuantity}
            onChange={(e) => setActualQuantity(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {normError && <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{normError}. Сырьё спишется по норме.</p>}
        {rows.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Сырьё</th>
                  <th className="px-3 py-2 text-right font-medium">Норма</th>
                  <th className="px-3 py-2 text-right font-medium">Факт</th>
                  <th className="px-3 py-2 text-right font-medium">Отклонение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.line.productId}>
                    <td className="px-3 py-2 text-foreground">
                      {r.line.name}
                      {r.line.fromStock && <span className="ml-1.5 text-xs text-muted">со склада</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-muted">
                      {formatQuantity(r.normQty)} {UNIT_LABELS_RU[r.line.unit]}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        inputMode="decimal"
                        value={used[r.line.productId] ?? ""}
                        onChange={(e) => setUsed((cur) => ({ ...cur, [r.line.productId]: e.target.value }))}
                        placeholder={formatQuantity(r.normQty)}
                        aria-label={`Факт: ${r.line.name}`}
                        className="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      />
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        r.deviation && r.deviation > 0 ? "text-red-600" : r.deviation && r.deviation < 0 ? "text-emerald-700" : "text-muted"
                      }`}
                    >
                      {r.typed === "" || r.deviation === null || r.deviation === 0
                        ? "—"
                        : `${r.deviation > 0 ? "+" : "−"}${formatQuantity(Math.abs(r.deviation))} ${UNIT_LABELS_RU[r.line.unit]}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : "Завершить и списать сырьё"}
        </button>
      </form>
    </Modal>
  );
}
