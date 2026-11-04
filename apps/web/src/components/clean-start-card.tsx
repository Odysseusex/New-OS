"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { CleanStartPreviewDto, CleanStartResultDto } from "@bakery-os/shared";
import { CLEAN_START_CONFIRMATION } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Modal } from "@/components/modal";

// «Начать учёт с чистого листа» — the owner only. The window first shows what goes and
// what stays (nothing is written), then needs a backup made today and the typed word.
export function CleanStartCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-red-200 bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Начать учёт с чистого листа</h2>
          <p className="mt-2 text-sm text-muted">Удаляет историю операций. Номенклатура, техкарты, точки, сотрудники и контрагенты остаются.</p>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50">
          Открыть
        </button>
      </div>
      {open && <CleanStartModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function CleanStartModal({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<CleanStartPreviewDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CleanStartResultDto | null>(null);

  useEffect(() => {
    api.cleanStart
      .preview()
      .then(setPreview)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить данные"));
  }, []);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setDone(await api.cleanStart.execute(word));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Очистка не выполнена");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Учёт начат с чистого листа" onClose={() => window.location.reload()} width="max-w-lg">
        <p className="mb-3 text-sm text-foreground">Удалено {formatDateTime(done.at)}.</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
          <li>Склад → «Приёмка» на каждой точке: сначала сырьё с ценой за единицу, затем готовая продукция</li>
          <li>Финансы → «Запустить»: остатки на счетах, дебиторская и кредиторская задолженность</li>
        </ol>
        <button onClick={() => window.location.reload()} className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90">
          Готово
        </button>
      </Modal>
    );
  }

  const total = preview?.remove.reduce((s, g) => s + g.count, 0) ?? 0;
  return (
    <Modal title="Начать учёт с чистого листа" onClose={onClose} width="max-w-2xl">
      {loadError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
      {!preview && !loadError && <p className="py-6 text-center text-sm text-muted">Загрузка…</p>}
      {preview && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Group title="Будет удалено" tone="text-red-700" rows={preview.remove.filter((g) => g.count > 0)} empty="Удалять нечего" />
            <Group title="Останется" tone="text-emerald-700" rows={preview.keep} />
          </div>
          <div className={`mt-4 rounded-xl px-3 py-2 text-sm ${preview.backupFresh ? "bg-surface-muted text-foreground" : "bg-amber-50 text-amber-800"}`}>
            {preview.backupFresh
              ? `Резервная копия: ${formatDateTime(preview.lastBackupAt!)}`
              : "Нет резервной копии за последние сутки — скачайте её в карточке «Резервная копия данных»"}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>Отменить нельзя. Касса не должна работать во время очистки.</span>
          </div>
          <label className="mb-1.5 mt-4 block text-sm font-medium text-foreground">Введите «{CLEAN_START_CONFIRMATION}»</label>
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200"
          />
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button
            onClick={run}
            disabled={busy || !preview.backupFresh || total === 0 || word.trim().toUpperCase() !== CLEAN_START_CONFIRMATION}
            className="mt-4 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Удаляем…" : "Удалить историю и начать заново"}
          </button>
        </>
      )}
    </Modal>
  );
}

function Group({ title, tone, rows, empty }: { title: string; tone: string; rows: { label: string; count: number }[]; empty?: string }) {
  return (
    <div className="rounded-xl border border-border">
      <p className={`border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</p>
      <ul className="divide-y divide-border text-sm">
        {rows.length === 0 && <li className="px-3 py-2 text-muted">{empty}</li>}
        {rows.map((r) => (
          <li key={r.label} className="flex justify-between gap-3 px-3 py-1.5">
            <span className="text-foreground">{r.label}</span>
            <span className="text-muted">{r.count.toLocaleString("ru-RU")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
