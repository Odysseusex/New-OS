"use client";

import { useEffect, useState } from "react";
import { PRODUCT_TYPE_LABELS_RU, PRODUCT_TYPE_ORDER } from "@bakery-os/shared";
import type { StandardCatalogResultDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

// Adds the starting catalogue of categories and subcategories. It only ever
// adds: nothing existing is renamed, moved or retyped, and no товар is assigned.
export function StandardCatalogModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<StandardCatalogResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.categories
      .standardCatalogPreview()
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить каталог"));
  }, []);

  async function handleApply() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.categories.standardCatalogApply();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить каталог");
    } finally {
      setIsSubmitting(false);
    }
  }

  const skipped = preview?.branches.filter((b) => b.categoryStatus === "skipped") ?? [];
  const nothingToAdd = preview !== null && preview.categoriesCreated === 0 && preview.subcategoriesCreated === 0;

  return (
    <Modal title="Стандартный каталог" onClose={onClose}>
      {!preview && !error && <p className="text-sm text-muted">Загрузка…</p>}
      {preview && (
        <>
          <div className="mb-4 space-y-1 text-sm text-foreground">
            <p>Будет добавлено категорий: <span className="font-semibold">{preview.categoriesCreated}</span></p>
            <p>Будет добавлено подкатегорий: <span className="font-semibold">{preview.subcategoriesCreated}</span></p>
          </div>

          <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border border-border">
            {PRODUCT_TYPE_ORDER.map((type) => {
              const rows = preview.branches.filter((b) => b.type === type && b.categoryStatus !== "skipped");
              if (rows.length === 0) return null;
              return (
                <div key={type} className="border-b border-border px-3 py-2 last:border-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{PRODUCT_TYPE_LABELS_RU[type]}</p>
                  {rows.map((b) => (
                    <p key={b.category} className="text-sm text-foreground">
                      {b.category}
                      <span className="text-muted"> — {b.subcategoriesToCreate.length} подкатегорий</span>
                    </p>
                  ))}
                </div>
              );
            })}
          </div>

          {skipped.length > 0 && (
            <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Не будут добавлены (категория с таким названием уже есть другого типа, без типа или в архиве):{" "}
              {skipped.map((b) => b.category).join(", ")}
            </div>
          )}
          <p className="mb-4 text-xs text-muted">
            Существующие категории и товары не меняются. Товары в новые категории переносите сами.
          </p>
        </>
      )}

      {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <button
        type="button"
        onClick={handleApply}
        disabled={isSubmitting || !preview || nothingToAdd}
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {isSubmitting ? "Добавление…" : nothingToAdd ? "Всё уже добавлено" : "Добавить каталог"}
      </button>
    </Modal>
  );
}
