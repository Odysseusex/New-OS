"use client";

import { useState } from "react";
import type { ProductionBatchDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.production.completeBatch(batch.id, { actualQuantity: Number(actualQuantity) });
      onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось завершить задание");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Завершить производственное задание" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-muted">
          {batch.productName} · план {batch.plannedQuantity} {UNIT_LABELS_RU[batch.unit]}
        </p>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Фактически произведено
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

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

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
