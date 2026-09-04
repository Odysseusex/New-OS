"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ProductDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function ForceDeleteProductModal({
  product,
  onClose,
  onDeleted,
}: {
  product: ProductDto;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canConfirm = confirmText.trim() === product.name;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfirm) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.products.forceRemove(product.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить принудительное удаление");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Принудительное удаление номенклатуры" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4 flex gap-3 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          <div>
            <p className="font-medium">Это действие необратимо.</p>
            <p className="mt-1">
              Товар «{product.name}» будет удалён полностью, вместе со всеми ссылками на него: остатками,
              складскими движениями, строками в продажах, закупках, накладных и маршрутах, а также
              использованием в рецептах и производственных заданиях. Восстановить эти данные будет
              невозможно.
            </p>
          </div>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Чтобы подтвердить, введите название товара ниже — точно как здесь, без добавления кавычек:
          </label>
          {/* No «» added around the name here — the name itself sometimes
              already contains them (e.g. «Хлеб «Бородинский»»), and a second,
              outer pair invited typing characters that were never part of
              the real name, which made the confirmation impossible to pass. */}
          <p className="mb-2 rounded-lg bg-surface-muted px-3 py-2 font-mono text-sm text-foreground">
            {product.name}
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={product.name}
            autoFocus
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={!canConfirm || isSubmitting}
          className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {isSubmitting ? "Удаление…" : "Удалить безвозвратно"}
        </button>
      </form>
    </Modal>
  );
}
