"use client";

import { useState } from "react";
import type { RecipeDto } from "@bakery-os/shared";
import { Modal } from "@/components/modal";

export function ExportRecipesPdfModal({
  recipes,
  onClose,
}: {
  recipes: RecipeDto[];
  onClose: () => void;
}) {
  const [showPrice, setShowPrice] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setIsExporting(true);
    try {
      const { downloadRecipesPdf } = await import("@/lib/pdf/recipe-pdf");
      await downloadRecipesPdf(recipes, { showPrice });
      onClose();
    } catch {
      setError("Не удалось сформировать PDF");
    } finally {
      setIsExporting(false);
    }
  }

  const title =
    recipes.length === 1 ? `Экспорт техкарты — ${recipes[0].productName}` : `Экспорт техкарт (${recipes.length})`;

  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        {recipes.length === 1
          ? "Технологическая карта в формате PDF, готовая для печати и отправки."
          : `${recipes.length} технологических карт — каждая начнётся с новой страницы одного PDF-файла.`}
      </p>

      <label className="mb-5 flex items-center gap-2.5 rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={showPrice}
          onChange={(e) => setShowPrice(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
        Показывать цену продажи и маржу
      </label>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <button
        onClick={handleExport}
        disabled={isExporting}
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {isExporting ? "Формирование PDF…" : "Скачать PDF"}
      </button>
    </Modal>
  );
}
