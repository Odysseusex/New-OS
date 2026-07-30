"use client";

import { useState } from "react";
import type { ProductionBatchDto } from "@bakery-os/shared";
import { PRODUCTION_CANCEL_REASON_LABELS_RU, ProductionCancelReason } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function AbortBatchModal({
  batch,
  onClose,
  onAborted,
}: {
  batch: ProductionBatchDto;
  onClose: () => void;
  onAborted: () => void;
}) {
  const [reason, setReason] = useState<ProductionCancelReason>(ProductionCancelReason.EQUIPMENT_FAILURE);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.production.cancelBatch(batch.id, { reason, note: note || undefined });
      onAborted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось прервать производство");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Прервать производство" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-muted">{batch.productName} — задание уже в процессе выполнения</p>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Причина</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as ProductionCancelReason)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {Object.values(ProductionCancelReason).map((r) => (
              <option key={r} value={r}>
                {PRODUCTION_CANCEL_REASON_LABELS_RU[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Комментарий <span className="text-muted">(необязательно)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Подробности…"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : "Прервать производство"}
        </button>
      </form>
    </Modal>
  );
}
