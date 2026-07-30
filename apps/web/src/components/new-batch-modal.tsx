"use client";

import { useState } from "react";
import type { LocationDto, RecipeDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { toDatetimeLocalValue } from "@/lib/format";

export function NewBatchModal({
  locations,
  recipes,
  fixedLocationId,
  onClose,
  onCreated,
}: {
  locations: LocationDto[];
  recipes: RecipeDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const productionLocations = locations.filter((l) => l.type === "BAKERY_PRODUCTION");
  const [locationId, setLocationId] = useState(fixedLocationId ?? productionLocations[0]?.id ?? "");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [plannedQuantity, setPlannedQuantity] = useState(String(recipes[0]?.yieldQuantity ?? "1"));
  const [scheduledFor, setScheduledFor] = useState(toDatetimeLocalValue(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.production.createBatch({
        locationId: fixedLocationId ?? locationId,
        recipeId,
        plannedQuantity: Number(plannedQuantity),
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать задание");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Новое производственное задание" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {!fixedLocationId && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Производство</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {productionLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Рецептура</label>
          <select
            value={recipeId}
            onChange={(e) => setRecipeId(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.productName} (выход {r.yieldQuantity} {UNIT_LABELS_RU[r.productUnit]})
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
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
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Дата и время начала
            </label>
            <input
              type="datetime-local"
              required
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || recipes.length === 0}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Создание…" : "Создать задание"}
        </button>
      </form>
    </Modal>
  );
}
