"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const STALE_DAYS = 7;

// «Скачать все данные»: the whole database as one file the owner keeps. Owner only —
// the endpoint behind it says the same.
export function BackupCard() {
  const [last, setLast] = useState<{ lastExportAt: string | null; lastExportBy: string | null } | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api.backup
      .status()
      .then((s) => {
        setLast(s);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDownload() {
    setBusy(true);
    setResult(null);
    try {
      const { filename, size } = await api.backup.download();
      setResult({ ok: true, text: `Скачано: ${filename} (${(size / 1024 / 1024).toFixed(1)} МБ)` });
      load();
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : "Не удалось скачать данные" });
    } finally {
      setBusy(false);
    }
  }

  const daysAgo = last?.lastExportAt ? Math.floor((Date.now() - new Date(last.lastExportAt).getTime()) / 86_400_000) : null;
  const stale = state === "ready" && (daysAgo === null || daysAgo >= STALE_DAYS);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Резервная копия данных</h2>
          {state === "error" && <p className="mt-2 text-sm text-red-600">Не удалось узнать дату последней выгрузки</p>}
          {state === "ready" && (
            <p className={stale ? "mt-2 text-sm text-amber-700" : "mt-2 text-sm text-muted"}>
              {last?.lastExportAt
                ? `Последняя выгрузка: ${formatDateTime(last.lastExportAt)}${last.lastExportBy ? ` · ${last.lastExportBy}` : ""}${stale ? ` — ${daysAgo} дн. назад` : ""}`
                : "Выгрузок ещё не было"}
            </p>
          )}
        </div>
        <button
          onClick={handleDownload}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Download className="h-4 w-4" strokeWidth={1.75} />
          {busy ? "Готовлю файл…" : "Скачать все данные"}
        </button>
      </div>
      {result && <p className={result.ok ? "mt-3 text-sm text-green-700" : "mt-3 text-sm text-red-600"}>{result.text}</p>}
    </div>
  );
}
