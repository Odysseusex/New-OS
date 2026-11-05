"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus } from "lucide-react";
import type { DirectionDto } from "@bakery-os/shared";
import { BusinessDirection, DIRECTION_MANAGE_ROLES, HARD_DELETE_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Modal } from "@/components/modal";
import { ExcelButton, exportDirections } from "@/components/directory-export";

const RULE_RU: Record<BusinessDirection, string> = {
  [BusinessDirection.WHOLESALE]: "Продажи оптовым клиентам",
  [BusinessDirection.RETAIL]: "Продажи точек без своего направления",
  [BusinessDirection.ORDERS]: "Оплаты заказов",
};

// Сеть точек → «Направления»: the directory of business directions (ТЗ §2).
export function DirectionsTab() {
  const { user } = useAuth();
  const canManage = user ? DIRECTION_MANAGE_ROLES.includes(user.role) : false;
  const canDelete = user ? HARD_DELETE_ROLES.includes(user.role) : false;
  const [rows, setRows] = useState<DirectionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<DirectionDto | "new" | null>(null);

  const load = useCallback(() => {
    api.directions
      .list()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить направления"));
  }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
    }
  }

  const visible = (rows ?? []).filter((d) => showArchived || d.isActive);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Показать архивные
        </label>
        <div className="flex items-center gap-2">
          <ExcelButton onClick={() => exportDirections(rows ?? [])} />
          {canManage && (
            <button
              onClick={() => setEditing("new")}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новое направление
            </button>
          )}
        </div>
      </div>
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Направление</th>
              <th className="px-5 py-3 font-medium">Ответственный</th>
              <th className="px-5 py-3 font-medium">Что попадает</th>
              <th className="px-5 py-3 font-medium text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-muted">
                  Загрузка…
                </td>
              </tr>
            ) : (
              visible.map((d) => (
                <tr key={d.id} className={clsx("border-b border-border last:border-0", !d.isActive && "opacity-50")}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    {d.name}
                    {!d.isActive && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">В архиве</span>}
                  </td>
                  <td className="px-5 py-3 text-muted">{d.responsible ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">
                    {[d.systemKey ? RULE_RU[d.systemKey] : null, d.locationNames.length > 0 ? `Точки: ${d.locationNames.join(", ")}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Расходы, отнесённые на направление"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-3 text-sm">
                        <button onClick={() => setEditing(d)} className="text-accent hover:underline">
                          Изменить
                        </button>
                        {!d.systemKey && (
                          <button
                            onClick={() => act(() => api.directions.update(d.id, { isActive: !d.isActive }))}
                            className="text-muted hover:text-foreground hover:underline"
                          >
                            {d.isActive ? "В архив" : "Вернуть"}
                          </button>
                        )}
                        {!d.systemKey && canDelete && !d.isActive && (
                          <button onClick={() => act(() => api.directions.remove(d.id))} className="text-red-700 hover:underline">
                            Удалить
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <DirectionModal
          direction={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DirectionModal({ direction, onClose, onSaved }: { direction?: DirectionDto; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(direction?.name ?? "");
  const [responsible, setResponsible] = useState(direction?.responsible ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (direction) await api.directions.update(direction.id, { name: name.trim(), responsible: responsible.trim() });
      else await api.directions.create({ name: name.trim(), responsible: responsible.trim() || undefined });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить направление");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <Modal title={direction ? "Изменить направление" : "Новое направление"} onClose={onClose} width="max-w-sm">
      <form onSubmit={submit}>
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </div>
        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Ответственный <span className="text-muted">(необязательно)</span>
          </label>
          <input maxLength={120} value={responsible} onChange={(e) => setResponsible(e.target.value)} className={input} />
        </div>
        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Сохранение…" : direction ? "Сохранить" : "Создать"}
        </button>
      </form>
    </Modal>
  );
}
