"use client";

import { useState } from "react";
import type { ProductionBatchDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { toDatetimeLocalValue } from "@/lib/format";

export function EditBatchModal({
  batch,
  onClose,
  onSaved,
}: {
  batch: ProductionBatchDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plannedQuantity, setPlannedQuantity] = useState(String(batch.plannedQuantity));
  const [scheduledFor, setScheduledFor] = useState(toDatetimeLocalValue(batch.scheduledFor));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.production.updateBatch(batch.id, {
        plannedQuantity: Number(plannedQuantity),
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить изменения");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Изменить производственное задание" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-muted">{batch.productName}</p>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Плановое количество
          </label>
          <input
            type="number"
            min="0"
            step="any"
            required
            value={plannedQuantity}
            onChange={(e) => setPlannedQuantity(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1.5 text-xs text-muted">Единица: {UNIT_LABELS_RU[batch.unit]}</p>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Дата и время начала</label>
          <input
            type="datetime-local"
            required
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
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
          {isSubmitting ? "Сохранение…" : "Сохранить"}
        </button>
      </form>
    </Modal>
  );
}
