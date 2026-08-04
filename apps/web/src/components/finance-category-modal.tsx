"use client";

import { useState } from "react";
import type { FinanceCategoryDto } from "@bakery-os/shared";
import { FinanceCategoryKind } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function FinanceCategoryModal({
  category,
  defaultKind,
  onClose,
  onSaved,
}: {
  category?: FinanceCategoryDto;
  // Which list ("Статьи доходов" / "Статьи расходов") the add action was
  // triggered from — the kind is unambiguous from that context, so there's
  // no toggle to pick it here.
  defaultKind: FinanceCategoryKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const kind = category?.kind ?? defaultKind;
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (category) {
        await api.finance.categories.update(category.id, { name });
      } else {
        await api.finance.categories.create({ name, kind });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить статью");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={category ? "Изменить статью ДДС" : `Новая статья ${kind === FinanceCategoryKind.INCOME ? "доходов" : "расходов"}`} onClose={onClose} width="max-w-sm">
      <form onSubmit={handleSubmit}>
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : category ? "Сохранить" : "Создать"}
        </button>
      </form>
    </Modal>
  );
}
