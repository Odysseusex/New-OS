"use client";

import { useState } from "react";
import type { CategoryDto } from "@bakery-os/shared";
import { PRODUCT_TYPE_LABELS_RU, PRODUCT_TYPE_ORDER, ProductType } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function CategoryModal({
  category,
  categories,
  defaultType,
  defaultParentId,
  onClose,
  onSaved,
}: {
  category?: CategoryDto;
  // Every category, for choosing a parent.
  categories: CategoryDto[];
  // Pre-filled when started from a type's or a category's own «Добавить».
  defaultType?: ProductType;
  defaultParentId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? defaultParentId ?? "");
  const [type, setType] = useState<ProductType | "">(
    category ? (category.type ?? "") : (categories.find((c) => c.id === defaultParentId)?.type ?? defaultType ?? ProductType.FINISHED_GOOD),
  );
  const parent = categories.find((c) => c.id === parentId);
  // What the category will be: a subcategory always takes its parent's type; a
  // typed category keeps its own; only a legacy untyped one may be given one.
  const effectiveType: ProductType | "" = parent?.type ?? type;
  const typeLocked = Boolean(parent) || (category !== undefined && category.type !== null);
  const hasChildren = category ? categories.some((c) => c.parentId === category.id) : false;
  // A category can only sit under a top-level, active category of its own type.
  const parentOptions = categories.filter(
    (c) =>
      !c.parentId &&
      c.isActive &&
      c.id !== category?.id &&
      c.type !== null &&
      (effectiveType === "" || c.type === effectiveType || parent?.id === c.id),
  );
  const [sortOrder, setSortOrder] = useState(
    category?.sortOrder != null ? String(category.sortOrder) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      // An empty box is a real answer — "leave this one at the end" — not a
      // validation failure, so it is sent as null rather than blocking a
      // rename over a number the user never set.
      const trimmed = sortOrder.trim();
      const order = trimmed ? Number(trimmed) : null;
      if (order !== null && (!Number.isInteger(order) || order < 1)) {
        setError("Порядок — целое число от 1");
        return;
      }
      if (!parent && !effectiveType && !category) {
        setError("Выберите тип");
        return;
      }
      const saved = category
        ? await api.categories.update(category.id, {
            name,
            sortOrder: order,
            ...(parentId !== (category.parentId ?? "") ? { parentId: parentId || null } : {}),
            ...(category.type === null && effectiveType ? { type: effectiveType } : {}),
          })
        : await api.categories.create({
            name,
            sortOrder: order,
            ...(parent ? { parentId: parent.id } : { type: effectiveType as ProductType }),
          });
      // The API strips fields it does not know about and still answers 200,
      // so a server running an older build saves the name, drops the order,
      // and nothing looks wrong until the list still reads «—». Check what
      // came back rather than trusting the status code.
      // `?? null` so an older server that sends no such field at all reads as
      // "unplaced" — which matches an empty box, and must not be reported as
      // a failure when nothing was asked for.
      if ((saved.sortOrder ?? null) !== order) {
        setError(
          "Название сохранено, но порядок не записался — сервер работает на старой версии. Повторите после обновления.",
        );
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить категорию");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title={category ? "Редактировать категорию" : parent || defaultParentId ? "Новая подкатегория" : "Новая категория"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Тип</label>
          <select
            value={effectiveType}
            disabled={typeLocked}
            onChange={(e) => {
              setType(e.target.value as ProductType | "");
              setParentId("");
            }}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
          >
            {category && category.type === null && <option value="">Не задан</option>}
            {PRODUCT_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS_RU[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Категория</label>
          <select
            value={parentId}
            disabled={hasChildren || (!category && Boolean(defaultParentId))}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
          >
            <option value="">Верхний уровень (сама категория)</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                Подкатегория «{c.name}»
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            required
            minLength={2}
            autoFocus
            placeholder={parentId ? "Батон, Круассаны…" : "Хлеб, Выпечка…"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Порядок в списке</label>
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Не задан"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1.5 text-xs text-muted">
            1 — первая на кассе, дальше по возрастанию. Пусто — в конце, по алфавиту
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : category ? "Сохранить" : parentId ? "Добавить подкатегорию" : "Добавить категорию"}
        </button>
      </form>
    </Modal>
  );
}
