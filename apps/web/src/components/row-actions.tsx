"use client";

import { Archive, Flame, Pencil, RotateCcw, Trash2 } from "lucide-react";

export function RowActions({
  isActive,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  onForceDelete,
}: {
  isActive: boolean;
  onEdit?: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete?: () => void;
  // Owner-only escape hatch that bypasses the usage check `onDelete` is
  // subject to — kept as a separate, visually distinct action rather than a
  // variant of onDelete so it can never be reached by accident.
  onForceDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {onEdit && (
        <button
          onClick={onEdit}
          title="Редактировать"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
      {isActive ? (
        <button
          onClick={onArchive}
          title="Архивировать"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-amber-600"
        >
          <Archive className="h-4 w-4" strokeWidth={1.75} />
        </button>
      ) : (
        <button
          onClick={onRestore}
          title="Восстановить"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-green-600"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          title="Удалить"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
      {onForceDelete && (
        <button
          onClick={onForceDelete}
          title="Принудительное удаление (только Разработчик)"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-red-50 hover:text-red-700"
        >
          <Flame className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

export function ArchivedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-accent"
      />
      Показать архивные
    </label>
  );
}

export function ArchivedBadge() {
  return (
    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted">
      Архив
    </span>
  );
}
