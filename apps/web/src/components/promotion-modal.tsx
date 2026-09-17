"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CategoryDto, LocationDto, PromotionDto } from "@bakery-os/shared";
import { Modal } from "./modal";
import { api, ApiError } from "@/lib/api";
import { toDatetimeLocalValue } from "@/lib/format";

interface RuleRow {
  categoryId: string;
  discountPercent: string;
}

// Defaults a new promotion's window to a short pilot: now through four days
// from now, matching the Merey coupon test this was built for — a full
// month would be a strange default for something meant to run a few days.
function defaultEndAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 4);
  return toDatetimeLocalValue(d);
}

export function PromotionModal({
  promotion,
  categories,
  locations,
  onClose,
  onSaved,
}: {
  promotion?: PromotionDto;
  categories: CategoryDto[];
  locations: LocationDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(promotion?.name ?? "");
  const [locationId, setLocationId] = useState(promotion?.locationId ?? "");
  const [startAt, setStartAt] = useState(
    promotion ? toDatetimeLocalValue(promotion.startAt) : toDatetimeLocalValue(new Date()),
  );
  const [endAt, setEndAt] = useState(promotion ? toDatetimeLocalValue(promotion.endAt) : defaultEndAt());
  const [maxRedemptions, setMaxRedemptions] = useState(
    promotion?.maxRedemptions != null ? String(promotion.maxRedemptions) : "",
  );
  const [isActive, setIsActive] = useState(promotion?.isActive ?? true);
  const [rules, setRules] = useState<RuleRow[]>(
    promotion?.rules.length
      ? promotion.rules.map((r) => ({ categoryId: r.categoryId, discountPercent: String(r.discountPercent) }))
      : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedCategoryIds = new Set(rules.map((r) => r.categoryId));
  const availableCategories = categories.filter((c) => !usedCategoryIds.has(c.id));

  function addRule() {
    if (availableCategories.length === 0) return;
    setRules((current) => [...current, { categoryId: availableCategories[0].id, discountPercent: "50" }]);
  }

  function updateRule(index: number, patch: Partial<RuleRow>) {
    setRules((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRule(index: number) {
    setRules((current) => current.filter((_, i) => i !== index));
  }

  const validRules = rules
    .filter((r) => r.categoryId && r.discountPercent.trim() !== "")
    .map((r) => ({ categoryId: r.categoryId, discountPercent: Number(r.discountPercent) }));

  const valid =
    name.trim().length > 0 &&
    startAt !== "" &&
    endAt !== "" &&
    new Date(endAt) > new Date(startAt) &&
    validRules.length > 0 &&
    validRules.every((r) => r.discountPercent > 0 && r.discountPercent < 100);

  async function handleSubmit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        locationId: locationId || undefined,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : undefined,
        rules: validRules,
      };
      if (promotion) {
        await api.promotions.update(promotion.id, { ...payload, isActive });
      } else {
        await api.promotions.create(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить акцию");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={promotion ? "Изменить акцию" : "Новая акция"} onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, «Мерей — купон»"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Точка</label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Вся сеть</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Купон этой акции сработает только на выбранной точке. Оставьте «Вся сеть», если акция не привязана к
            одному месту.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Начало</label>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Окончание</label>
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Лимит погашений <span className="font-normal text-muted">(необязательно)</span>
          </label>
          <input
            type="number"
            min={1}
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder="Без лимита"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {promotion && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Акция активна
          </label>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">Правила скидки по категориям</label>
            {availableCategories.length > 0 && (
              <button
                type="button"
                onClick={addRule}
                className="flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Добавить
              </button>
            )}
          </div>
          <div className="space-y-2">
            {rules.map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={rule.categoryId}
                  onChange={(e) => updateRule(i, { categoryId: e.target.value })}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  {[categories.find((c) => c.id === rule.categoryId), ...availableCategories]
                    .filter((c): c is CategoryDto => !!c)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={rule.discountPercent}
                    onChange={(e) => updateRule(i, { discountPercent: e.target.value })}
                    className="w-16 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <span className="text-sm text-muted">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  aria-label="Убрать правило"
                  className="shrink-0 text-muted transition hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            ))}
            {rules.length === 0 && <p className="text-sm text-muted">Добавьте хотя бы одну категорию</p>}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!valid || saving}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "…" : promotion ? "Сохранить" : "Создать акцию"}
        </button>
      </div>
    </Modal>
  );
}
