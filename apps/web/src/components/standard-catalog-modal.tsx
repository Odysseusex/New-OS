"use client";

import { useEffect, useState } from "react";
import { PRODUCT_TYPE_LABELS_RU, PRODUCT_TYPE_ORDER } from "@bakery-os/shared";
import type { StandardCatalogResultDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

// Adds the starting catalogue of top-level categories. It only ever
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

  const nothingToAdd = preview !== null && preview.categoriesCreated === 0;

  return (
    <Modal title="Стандартный каталог" onClose={onClose}>
      {!preview && !error && <p className="text-sm text-muted">Загрузка…</p>}
      {preview && (
        <>
          <div className="mb-4 space-y-1 text-sm text-foreground">
            <p>Будет добавлено категорий: <span className="font-semibold">{preview.categoriesCreated}</span></p>
          </div>

          <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border border-border">
            {PRODUCT_TYPE_ORDER.map((type) => {
              const rows = preview.branches.filter((b) => b.type === type);
              if (rows.length === 0) return null;
              return (
                <div key={type} className="border-b border-border px-3 py-2 last:border-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{PRODUCT_TYPE_LABELS_RU[type]}</p>
                  {rows.map((b) => (
                    <p key={b.category} className="text-sm text-foreground">
                      {b.category}
                      <span className="text-muted">
                        {" — "}
                        {b.categoryStatus === "created"
                          ? "будет создана"
                          : b.categoryStatus === "reused"
                            ? b.existingName
                              ? `уже есть («${b.existingName}»)`
                              : "уже есть"
                            : `пропущена («${b.existingName}»: другой тип, без типа или в архиве)`}
                      </span>
                    </p>
                  ))}
                </div>
              );
            })}
          </div>

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
