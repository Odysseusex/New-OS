"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { FileSpreadsheet } from "lucide-react";
import type { ReferenceCell, ReferenceImportPreviewDto, ReferenceImportResultDto, ReferenceImportRowDto, ReferenceKind } from "@bakery-os/shared";
import { REFERENCE_COLUMNS, REFERENCE_IMPORT_MAX_ROWS, REFERENCE_KIND_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { downloadTable } from "@/lib/export-table";
import { readFirstSheet } from "@/lib/xlsx-read";
import { Modal } from "@/components/modal";

const FILE_NAMES: Record<ReferenceKind, string> = { products: "nomenklatura", customers: "klienty", suppliers: "postavshchiki" };

const ACTION_LABEL: Record<ReferenceImportRowDto["action"], string> = {
  CREATE: "Новый",
  UPDATE: "Изменить",
  UNCHANGED: "Без изменений",
  ERROR: "Ошибка",
};
const ACTION_STYLE: Record<ReferenceImportRowDto["action"], string> = {
  CREATE: "bg-emerald-50 text-emerald-700",
  UPDATE: "bg-sky-50 text-sky-700",
  UNCHANGED: "bg-surface-muted text-muted",
  ERROR: "bg-red-50 text-red-700",
};

// «Excel» next to a directory's «Новый …» button: template, export, load.
export function ReferenceExcelButton({ kind, onChanged }: { kind: ReferenceKind; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
      >
        <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
        Excel
      </button>
      {open && <ReferenceExcelModal kind={kind} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

function ReferenceExcelModal({ kind, onClose, onChanged }: { kind: ReferenceKind; onClose: () => void; onChanged: () => void }) {
  const title = REFERENCE_KIND_LABELS_RU[kind];
  const [grid, setGrid] = useState<ReferenceCell[][] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReferenceImportPreviewDto | null>(null);
  const [result, setResult] = useState<ReferenceImportResultDto | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    await downloadTable(`shablon-${FILE_NAMES[kind]}`, REFERENCE_COLUMNS[kind].map((c) => c.header), [], { sheetName: title });
  }

  async function exportAll() {
    setError(null);
    setBusy(true);
    try {
      const out = await api.referenceData.export(kind);
      await downloadTable(FILE_NAMES[kind], out.headers, out.rows, { sheetName: title });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выгрузить справочник");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    setResult(null);
    if (!file) return;
    setBusy(true);
    try {
      const cells = await readFirstSheet(await file.arrayBuffer());
      if (cells.length > REFERENCE_IMPORT_MAX_ROWS + 50) {
        setError(`В файле больше ${REFERENCE_IMPORT_MAX_ROWS} строк — разбейте его на части`);
        return;
      }
      setGrid(cells);
      setFileName(file.name);
      setPreview(await api.referenceData.preview(kind, cells));
      setOnlyProblems(false);
    } catch (err) {
      setGrid(null);
      setError(err instanceof ApiError ? err.message : "Не удалось прочитать файл — нужен .xlsx или .xls");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleApply() {
    if (!grid) return;
    setError(null);
    setBusy(true);
    try {
      setResult(await api.referenceData.apply(kind, grid));
      setPreview(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить");
    } finally {
      setBusy(false);
    }
  }

  const rows = preview ? preview.rows.filter((r) => !onlyProblems || r.action === "ERROR" || r.warning) : [];
  const toWrite = preview ? preview.counts.CREATE + preview.counts.UPDATE : 0;

  return (
    <Modal title={`${title} — Excel`} onClose={onClose} width="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void downloadTemplate()}
          className="rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-foreground transition hover:bg-surface-muted"
        >
          Скачать шаблон
        </button>
        <button
          onClick={() => void exportAll()}
          disabled={busy}
          className="rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-foreground transition hover:bg-surface-muted disabled:opacity-50"
        >
          Выгрузить справочник
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          Загрузить файл
        </button>
        <input ref={fileInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
        {fileName && <span className="text-sm text-muted">{fileName}</span>}
      </div>

      <p className="mb-4 text-xs text-muted">
        {kind === "products"
          ? "Товар находится по артикулу, без артикула — по наименованию."
          : "Запись находится по БИН/ИИН, без него — по наименованию."}{" "}
        Пустая ячейка не меняет значение.
      </p>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {busy && !preview && !result && <p className="py-6 text-center text-sm text-muted">Загрузка…</p>}

      {result && (
        <div className="mb-4 rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
          <p className="font-medium text-foreground">
            Добавлено: {result.created} · Изменено: {result.updated} · Без изменений: {result.unchanged}
            {result.failed.length > 0 && <span className="text-red-700"> · Не загружено: {result.failed.length}</span>}
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-red-700">
              {result.failed.map((r) => (
                <li key={r.row}>
                  Строка {r.row}
                  {r.name ? ` «${r.name}»` : ""}: {r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Count label="Новых" value={preview.counts.CREATE} tone="text-emerald-700" />
            <Count label="Изменить" value={preview.counts.UPDATE} tone="text-sky-700" />
            <Count label="Без изменений" value={preview.counts.UNCHANGED} />
            <Count label="Ошибок" value={preview.counts.ERROR} tone={preview.counts.ERROR > 0 ? "text-red-700" : undefined} />
            <label className="ml-auto flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              Только ошибки
            </label>
          </div>
          {preview.ignoredHeaders.length > 0 && (
            <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Колонки не распознаны и не загрузятся: {preview.ignoredHeaders.join(", ")}</p>
          )}
          <div className="mb-4 max-h-[50vh] overflow-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Строка</th>
                  <th className="px-3 py-2 font-medium">{kind === "products" ? "Артикул" : "БИН/ИИН"}</th>
                  <th className="px-3 py-2 font-medium">Наименование</th>
                  <th className="px-3 py-2 font-medium">Действие</th>
                  <th className="px-3 py-2 font-medium">Что меняется</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {rows.map((r) => (
                  <tr key={r.row} className="align-top">
                    <td className="px-3 py-2 text-muted">{r.row}</td>
                    <td className="px-3 py-2 text-muted">{r.key ?? "—"}</td>
                    <td className="px-3 py-2 text-foreground">{r.name || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={clsx("rounded-lg px-2 py-0.5 text-xs font-medium", ACTION_STYLE[r.action])}>{ACTION_LABEL[r.action]}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.error && <p className="text-red-700">{r.error}</p>}
                      {r.warning && <p className="text-amber-700">{r.warning}</p>}
                      {r.changes.map((c) => (
                        <p key={c.field} className="text-foreground">
                          <span className="text-muted">{c.field}:</span>{" "}
                          {r.action === "UPDATE" && <span className="text-muted line-through">{c.before ?? "пусто"}</span>}
                          {r.action === "UPDATE" && " → "}
                          {c.after ?? "пусто"}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            data-submit
            onClick={() => void handleApply()}
            disabled={busy || toWrite === 0}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Загрузка…" : toWrite === 0 ? "Нечего загружать" : `Применить: ${toWrite} ${preview.counts.ERROR > 0 ? "(строки с ошибками пропустятся)" : ""}`}
          </button>
        </>
      )}
    </Modal>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className="rounded-xl border border-border bg-surface px-3 py-1.5">
      <span className="text-muted">{label}:</span> <span className={clsx("font-semibold", tone ?? "text-foreground")}>{value}</span>
    </span>
  );
}
