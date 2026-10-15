"use client";

import { useRef, useState } from "react";
import type { LoyaltyImportPreviewDto, LoyaltyImportResultDto, LoyaltyImportRowInput } from "@bakery-os/shared";
import {
  formatKzPhone,
  LOYALTY_CONSENT_CHANNEL_LABELS_RU,
  LOYALTY_IMPORT_ROW_STATUS_LABELS_RU,
  LoyaltyImportRowStatus,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { parseLoyaltyImportFile } from "@/lib/parse-table";
import { Modal } from "@/components/modal";
import { inputClass } from "@/components/loyalty-shared";

const MAX_ROWS = 5000;

export function LoyaltyImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<LoyaltyImportRowInput[]>([]);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<LoyaltyImportPreviewDto | null>(null);
  const [result, setResult] = useState<LoyaltyImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreview(null);
    setResult(null);
    const parsed = parseLoyaltyImportFile(await file.text());
    if (parsed.length === 0) {
      setError("В файле нет строк");
      return;
    }
    if (parsed.length > MAX_ROWS) {
      setError(`Слишком много строк: ${parsed.length}. Не больше ${MAX_ROWS} за раз`);
      return;
    }
    setFileName(file.name);
    setRows(parsed);
  }

  async function handlePreview() {
    setError(null);
    setBusy(true);
    try {
      setPreview(await api.loyalty.previewImport(rows));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось проверить файл");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setError(null);
    setBusy(true);
    try {
      setResult(await api.loyalty.applyImport(rows, note));
      setPreview(null);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить клиентов");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Импорт розничных клиентов" onClose={onClose} width="max-w-3xl">
      {result && (
        <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Добавлено клиентов: {result.created}. Пропущено строк: {result.skipped}.
        </div>
      )}
      {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input ref={fileInput} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
        >
          Выбрать файл
        </button>
        <span className="text-sm text-muted">
          {fileName ? `${fileName} — строк: ${rows.length}` : "Колонки: телефон, имя, согласие, whatsapp, telegram, sms, примечание"}
        </span>
        <button
          type="button"
          onClick={handlePreview}
          disabled={busy || rows.length === 0}
          className="ml-auto rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy && !preview ? "Проверка…" : "Предпросмотр"}
        </button>
      </div>

      {preview && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Строк", preview.rows.length],
              ["Будет добавлено", preview.newCount],
              ["Пропущено", preview.skippedCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border px-4 py-3">
                <p className="text-lg font-semibold text-foreground">{value}</p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>

          <div className="mb-4 max-h-80 overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Строка</th>
                  <th className="px-3 py-2 font-medium">Телефон</th>
                  <th className="px-3 py-2 font-medium">Имя</th>
                  <th className="px-3 py-2 font-medium">Рассылки</th>
                  <th className="px-3 py-2 font-medium">Итог</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="px-3 py-2 text-muted">{r.line}</td>
                    <td className="px-3 py-2 text-foreground">{r.phone ? formatKzPhone(r.phone) : r.rawPhone || "—"}</td>
                    <td className="px-3 py-2 text-foreground">{r.name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">
                      {r.marketingChannels.map((c) => LOYALTY_CONSENT_CHANNEL_LABELS_RU[c]).join(", ") || "—"}
                    </td>
                    <td className={`px-3 py-2 font-medium ${r.status === LoyaltyImportRowStatus.NEW ? "text-emerald-700" : "text-muted"}`}>
                      {LOYALTY_IMPORT_ROW_STATUS_LABELS_RU[r.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Откуда согласия в файле</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: бумажные анкеты 2025" className={inputClass} />
          </div>

          <p className="mb-4 text-sm text-muted">Номера, которые уже есть в базе, не меняются.</p>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleApply}
              disabled={busy || preview.newCount === 0 || note.trim().length < 3}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Загрузка…" : `Добавить ${preview.newCount}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
