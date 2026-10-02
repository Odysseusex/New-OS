"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type {
  ClassificationBatchDto,
  ClassificationPreviewDto,
  ClassificationPreviewRowDto,
  ClassificationRevertResultDto,
  ClassificationRowInput,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { parseClassificationFile } from "@/lib/parse-table";
import { Modal } from "@/components/modal";

type Tab = "load" | "history";
type Filter = "ALL" | "MOVE" | "REJECT" | "SKIP" | "WARN";

const STATUS_LABEL: Record<ClassificationPreviewRowDto["status"], string> = {
  MOVE: "Перенести",
  UNCHANGED: "Без изменений",
  SKIP: "Пропуск",
  REJECT: "Отклонено",
};
const STATUS_STYLE: Record<ClassificationPreviewRowDto["status"], string> = {
  MOVE: "bg-emerald-50 text-emerald-700",
  UNCHANGED: "bg-surface-muted text-muted",
  SKIP: "bg-amber-50 text-amber-800",
  REJECT: "bg-red-50 text-red-700",
};
const BATCH_STATUS_LABEL: Record<ClassificationBatchDto["status"], string> = {
  APPLIED: "Применён",
  PARTIALLY_REVERTED: "Отменён частично",
  REVERTED: "Отменён",
};

// Preview → Apply → Undo for a file of «артикул → категория › подкатегория».
// Nothing is written until «Применить»; the preview itself changes nothing.
export function ClassificationModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("load");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ClassificationRowInput[]>([]);
  const [preview, setPreview] = useState<ClassificationPreviewDto | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [acceptRejected, setAcceptRejected] = useState(false);
  const [note, setNote] = useState("");
  const [applied, setApplied] = useState<ClassificationBatchDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [batches, setBatches] = useState<ClassificationBatchDto[] | null>(null);
  const [removeEmpty, setRemoveEmpty] = useState(false);
  const [revertResult, setRevertResult] = useState<ClassificationRevertResultDto | null>(null);

  useEffect(() => {
    if (tab !== "history") return;
    api.classification
      .batches()
      .then(setBatches)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить историю"));
  }, [tab, applied, revertResult]);

  async function handleFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    setApplied(null);
    setAcceptRejected(false);
    if (!file) return;
    try {
      const parsed = parseClassificationFile(await file.text());
      if (parsed.length === 0) {
        setError("В файле нет строк");
        return;
      }
      if (parsed.length > 1000) {
        setError("В файле больше 1000 строк — разбейте его на части");
        return;
      }
      setFileName(file.name);
      setRows(parsed);
    } catch {
      setError("Не удалось прочитать файл");
    }
  }

  async function handlePreview() {
    setError(null);
    setBusy(true);
    try {
      setPreview(await api.classification.preview(rows));
      setFilter("ALL");
      setAcceptRejected(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сделать предпросмотр");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const batch = await api.classification.apply({ rows, fingerprint: preview.fingerprint, acceptRejected, note: note.trim() || undefined });
      setApplied(batch);
      setPreview(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось применить");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevert(batch: ClassificationBatchDto) {
    if (!window.confirm(`Отменить пакет от ${formatDateTime(batch.createdAt)}? Товары вернутся в прежние категории.`)) return;
    setError(null);
    setBusy(true);
    try {
      setRevertResult(await api.classification.revert(batch.id, { removeEmptyCategories: removeEmpty }));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить");
    } finally {
      setBusy(false);
    }
  }

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((r) => {
      if (filter === "ALL") return true;
      if (filter === "WARN") return r.warning !== null;
      return r.status === filter;
    });
  }, [preview, filter]);

  const s = preview?.summary;
  const canApply = preview !== null && s !== undefined && s.toMove > 0 && (s.rejected === 0 || acceptRejected);

  return (
    <Modal title="Классификация товаров" onClose={onClose} width="max-w-5xl">
      <div className="mb-4 flex gap-1 rounded-xl bg-surface-muted p-1 text-sm">
        {(["load", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setError(null);
            }}
            className={clsx("rounded-lg px-4 py-1.5 font-medium transition", tab === t ? "bg-surface text-foreground shadow-card" : "text-muted hover:text-foreground")}
          >
            {t === "load" ? "Загрузка" : "История"}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {tab === "load" && (
        <>
          {applied && (
            <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Применено: перенесено товаров — {applied.productsMoved}, создано категорий и подкатегорий — {applied.categoriesCreated}. Отменить можно во вкладке «История».
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input ref={fileInput} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <button
              onClick={() => fileInput.current?.click()}
              className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              Выбрать файл
            </button>
            <span className="text-sm text-muted">{fileName ? `${fileName} — строк: ${rows.length}` : "Колонки: артикул, название, тип, категория, подкатегория"}</span>
            <button
              onClick={handlePreview}
              disabled={busy || rows.length === 0}
              className="ml-auto rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {busy && !preview ? "Проверка…" : "Предпросмотр"}
            </button>
          </div>

          {preview && s && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Строк", s.rows],
                  ["К переносу", s.toMove],
                  ["Без изменений", s.unchanged],
                  ["Пропущено", s.skipped],
                  ["Отклонено", s.rejected],
                  ["Создастся категорий", s.categoriesToCreate],
                  ["Создастся подкатегорий", s.subcategoriesToCreate],
                  ["Не в файле", s.productsNotInFile],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl border border-border px-3 py-2">
                    <p className="text-xs text-muted">{label}</p>
                    <p className="text-lg font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              {preview.promotions.length > 0 && (
                <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="mb-1 font-medium">Акции, у которых категория потеряет товары:</p>
                  {preview.promotions.map((p) => (
                    <p key={`${p.promotionId}:${p.categoryName}`}>
                      «{p.promotionName}» — «{p.categoryName}»: товаров уходит {p.productsLeaving}
                    </p>
                  ))}
                </div>
              )}

              <div className="mb-3 flex flex-wrap gap-1 text-xs">
                {([
                  ["ALL", "Все"],
                  ["MOVE", "К переносу"],
                  ["REJECT", "Отклонено"],
                  ["SKIP", "Пропущено"],
                  ["WARN", "С предупреждением"],
                ] as [Filter, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={clsx("rounded-lg px-3 py-1.5 font-medium transition", filter === key ? "bg-accent text-accent-foreground" : "bg-surface-muted text-muted hover:text-foreground")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-4 max-h-80 overflow-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-3 py-2 font-medium">№</th>
                      <th className="px-3 py-2 font-medium">Артикул</th>
                      <th className="px-3 py-2 font-medium">Товар</th>
                      <th className="px-3 py-2 font-medium">Сейчас</th>
                      <th className="px-3 py-2 font-medium">Станет</th>
                      <th className="px-3 py-2 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleRows.map((r) => (
                      <tr key={r.line}>
                        <td className="px-3 py-2 text-muted">{r.line}</td>
                        <td className="px-3 py-2 text-muted">{r.sku || "—"}</td>
                        <td className="px-3 py-2 text-foreground">{r.productName ?? r.fileName ?? "—"}</td>
                        <td className="px-3 py-2 text-muted">{r.currentPath ?? "—"}</td>
                        <td className="px-3 py-2 text-foreground">{r.targetPath ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status]}</span>
                          {r.reason && <p className="mt-0.5 text-xs text-muted">{r.reason}</p>}
                          {r.warning && <p className="mt-0.5 text-xs text-amber-700">{r.warning}</p>}
                        </td>
                      </tr>
                    ))}
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">
                          Нет строк
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mb-3">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                  placeholder="Заметка к пакету (необязательно)"
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>

              {s.rejected > 0 && (
                <label className="mb-3 flex items-start gap-2.5 text-sm text-foreground">
                  <input type="checkbox" checked={acceptRejected} onChange={(e) => setAcceptRejected(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent/20" />
                  <span>Применить остальные строки без отклонённых ({s.rejected})</span>
                </label>
              )}

              <p className="mb-3 text-xs text-muted">Меняется только категория товара. Цены, остатки, продажи и статус «под реализацию» не меняются.</p>

              <button
                onClick={handleApply}
                disabled={busy || !canApply}
                className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Применение…" : `Применить (товаров: ${s.toMove})`}
              </button>
            </>
          )}
        </>
      )}

      {tab === "history" && (
        <>
          {revertResult && (
            <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Возвращено товаров: {revertResult.restored}
              {revertResult.categoriesRemoved > 0 && `, удалено пустых категорий: ${revertResult.categoriesRemoved}`}.
              {revertResult.conflicts.length > 0 && (
                <div className="mt-2 text-amber-900">
                  <p className="font-medium">Не возвращены ({revertResult.conflicts.length}):</p>
                  {revertResult.conflicts.map((c) => (
                    <p key={c.sku}>
                      {c.sku} {c.productName} — {c.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="mb-3 flex items-start gap-2.5 text-sm text-foreground">
            <input type="checkbox" checked={removeEmpty} onChange={(e) => setRemoveEmpty(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent/20" />
            <span>При отмене удалять созданные пакетом категории, если они пустые</span>
          </label>

          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Кто</th>
                  <th className="px-3 py-2 text-right font-medium">Товаров</th>
                  <th className="px-3 py-2 text-right font-medium">Вернули</th>
                  <th className="px-3 py-2 text-right font-medium">Создано категорий</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(batches ?? []).map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 text-foreground">
                      {formatDateTime(b.createdAt)}
                      {b.note && <p className="text-xs text-muted">{b.note}</p>}
                    </td>
                    <td className="px-3 py-2 text-muted">{b.createdByName}</td>
                    <td className="px-3 py-2 text-right text-foreground">{b.productsMoved}</td>
                    <td className="px-3 py-2 text-right text-muted">{b.productsRestored}</td>
                    <td className="px-3 py-2 text-right text-muted">{b.categoriesCreated}</td>
                    <td className="px-3 py-2 text-foreground">{BATCH_STATUS_LABEL[b.status]}</td>
                    <td className="px-3 py-2 text-right">
                      {b.status !== "REVERTED" && (
                        <button
                          onClick={() => handleRevert(b)}
                          disabled={busy}
                          className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-60"
                        >
                          Отменить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {batches !== null && batches.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">
                      Пакетов пока нет
                    </td>
                  </tr>
                )}
                {batches === null && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">
                      Загрузка…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
