"use client";

import { useState } from "react";
import type { CategoryDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function CategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category?: CategoryDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (category) {
        await api.categories.update(category.id, { name });
      } else {
        await api.categories.create({ name });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить категорию");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={category ? "Редактировать категорию" : "Новая категория"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            required
            minLength={2}
            autoFocus
            placeholder="Хлеб, Выпечка…"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          {isSubmitting ? "Сохранение…" : category ? "Сохранить" : "Добавить категорию"}
        </button>
      </form>
    </Modal>
  );
}
