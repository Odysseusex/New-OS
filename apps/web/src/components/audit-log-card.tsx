"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditLogEntryDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const PAGE = 50;

// Read-only. Entries are written by the changes themselves, in the same
// transaction; nothing here can add, edit or remove one.
export function AuditLogCard() {
  const [rows, setRows] = useState<AuditLogEntryDto[]>([]);
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.audit
      .list({ action: action.trim() || undefined, limit: PAGE, offset })
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить журнал"));
  }, [action, offset]);
  useEffect(load, [load]);

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Журнал аудита</h2>
        <input
          value={action}
          onChange={(e) => {
            setOffset(0);
            setAction(e.target.value);
          }}
          placeholder="Действие, например period.close"
          className="w-64 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      {error && <p className="px-5 py-3 text-sm text-red-700">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-5 py-3 font-medium">Время</th>
            <th className="px-5 py-3 font-medium">Кто</th>
            <th className="px-5 py-3 font-medium">Действие</th>
            <th className="px-5 py-3 font-medium">Объект</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <>
              <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="cursor-pointer hover:bg-surface-muted">
                <td className="px-5 py-2.5 text-muted">{formatDateTime(r.createdAt)}</td>
                <td className="px-5 py-2.5 text-foreground">{r.actorName ?? "—"}</td>
                <td className="px-5 py-2.5 font-mono text-xs text-foreground">{r.action}</td>
                <td className="px-5 py-2.5 text-muted">{r.entityType}</td>
              </tr>
              {open === r.id && (
                <tr key={`${r.id}-detail`}>
                  <td colSpan={4} className="space-y-2 bg-surface-muted px-5 py-3 text-xs text-foreground">
                    {r.reason && <div>Причина: {r.reason}</div>}
                    {r.before !== null && <pre className="overflow-x-auto whitespace-pre-wrap">Было: {JSON.stringify(r.before, null, 1)}</pre>}
                    {r.after !== null && <pre className="overflow-x-auto whitespace-pre-wrap">Стало: {JSON.stringify(r.after, null, 1)}</pre>}
                  </td>
                </tr>
              )}
            </>
          ))}
          {rows.length === 0 && !error && (
            <tr>
              <td colSpan={4} className="px-5 py-8 text-center text-muted">
                Записей нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex justify-between border-t border-border px-5 py-3 text-sm">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="text-accent disabled:opacity-40">
          ← Новее
        </button>
        <button disabled={rows.length < PAGE} onClick={() => setOffset(offset + PAGE)} className="text-accent disabled:opacity-40">
          Старше →
        </button>
      </div>
    </div>
  );
}
