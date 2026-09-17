"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import {
  BUSINESS_CONTEXT_MODULES,
  BUSINESS_CONTEXT_MODULE_LABELS_RU,
  businessContextFilename,
  formatBusinessContext,
  type BusinessContextDto,
  type BusinessContextLevel,
  type BusinessContextModule,
  type LocationDto,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import {
  addDaysKey,
  firstOfMonthKey,
  startOfZonedDay,
  zonedDateKey,
} from "@/lib/reporting-period";

// «Контекст для AI» — the export an external model reads.
//
// The page holds the DTO, never a pre-rendered string from the server: the
// Markdown shown here is produced by the same pure formatter that produces
// the downloaded file, so the preview cannot drift from what gets copied.
// That is the whole reason the preview is the raw text rather than a prettier
// rendering of it — what you see is literally what lands in the clipboard.

type PeriodKey = "7d" | "30d" | "month" | "90d";

const PERIOD_LABELS: Record<PeriodKey, string> = {
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
  "90d": "3 месяца",
};

// Almaty calendar days, the same rule every report uses — the server buckets
// on them, so asking in the browser's own days would put the boundary in a
// different place than the numbers inside.
function periodRange(period: PeriodKey): { from: Date; to: Date } {
  const today = zonedDateKey();
  const to = new Date();
  if (period === "7d") return { from: startOfZonedDay(addDaysKey(today, -6)), to };
  if (period === "30d") return { from: startOfZonedDay(addDaysKey(today, -29)), to };
  if (period === "90d") return { from: startOfZonedDay(addDaysKey(today, -89)), to };
  return { from: startOfZonedDay(firstOfMonthKey(today)), to };
}

const LEVELS: { key: BusinessContextLevel; label: string; hint: string }[] = [
  { key: "quick", label: "Быстрый", hint: "для короткого вопроса" },
  { key: "business", label: "Основной", hint: "полная картина бизнеса" },
  { key: "full", label: "Полный", hint: "максимум деталей" },
];

function download(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function BusinessContextTab({ locations }: { locations: LocationDto[] }) {
  const [level, setLevel] = useState<BusinessContextLevel>("business");
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [locationId, setLocationId] = useState("");
  const [modules, setModules] = useState<BusinessContextModule[]>([...BUSINESS_CONTEXT_MODULES]);
  const [context, setContext] = useState<BusinessContextDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Rendered once per context, not per keystroke — a full export is tens of
  // thousands of characters and re-rendering it on every unrelated state
  // change would be felt on the monoblock.
  const markdown = useMemo(() => (context ? formatBusinessContext(context) : ""), [context]);

  function toggleModule(module: BusinessContextModule) {
    setModules((current) =>
      current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
    );
  }

  async function generate() {
    setIsLoading(true);
    setError(null);
    setCopied(false);
    try {
      const { from, to } = periodRange(period);
      setContext(
        await api.ai.businessContext({
          from: from.toISOString(),
          to: to.toISOString(),
          level,
          locationId: locationId || undefined,
          modules,
        }),
      );
    } catch (err) {
      setContext(null);
      setError(err instanceof ApiError ? err.message : "Не удалось собрать контекст");
    } finally {
      setIsLoading(false);
    }
  }

  async function copy() {
    try {
      // The whole document, not the visible part of the preview.
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Браузер не дал скопировать. Скачайте файл — он тот же самый.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <p className="mb-5 text-sm text-muted">
          Собирает данные ArAmir за период в один структурированный текст. Скопируйте его в ChatGPT
          (или другую AI-модель) и задавайте вопросы по своему бизнесу — модель будет отвечать по
          реальным цифрам. Сам ArAmir при этом никуда ничего не отправляет.
        </p>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Уровень</label>
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLevel(l.key)}
                className={clsx(
                  "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
                  level === l.key ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
                )}
              >
                {l.label}
                <span className="ml-1.5 text-xs font-normal text-muted">{l.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Период</label>
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
              {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={clsx(
                    "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
                    period === p ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
                  )}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Точка</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Вся сеть</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Что включить</label>
          <div className="flex flex-wrap gap-2">
            {BUSINESS_CONTEXT_MODULES.map((module) => (
              <label
                key={module}
                className={clsx(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
                  modules.includes(module)
                    ? "border-accent bg-accent/5 text-foreground"
                    : "border-border text-muted hover:text-foreground",
                )}
              >
                <input
                  type="checkbox"
                  checked={modules.includes(module)}
                  onChange={() => toggleModule(module)}
                  className="h-4 w-4 rounded border-border accent-accent"
                />
                {BUSINESS_CONTEXT_MODULE_LABELS_RU[module]}
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={generate}
          disabled={isLoading || modules.length === 0}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
          {isLoading ? "Собираем…" : "Сформировать контекст"}
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {context && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="text-sm">
              <p className="font-medium text-foreground">
                Готово · {(markdown.length / 1024).toFixed(0)} КБ
              </p>
              <p className="mt-0.5 text-muted">
                {Object.entries(context.meta.recordCounts)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={copy}
                className={clsx(
                  "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                  copied
                    ? "bg-green-600 text-white"
                    : "bg-accent text-accent-foreground hover:opacity-90",
                )}
              >
                {copied ? <Check className="h-4 w-4" strokeWidth={2} /> : <Copy className="h-4 w-4" strokeWidth={1.75} />}
                {copied ? "Скопировано" : "Скопировать"}
              </button>
              <button
                onClick={() => download(businessContextFilename(context, "md"), markdown, "text/markdown")}
                className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Download className="h-4 w-4" strokeWidth={1.75} />
                .md
              </button>
              <button
                onClick={() =>
                  download(
                    businessContextFilename(context, "txt"),
                    formatBusinessContext(context, { plain: true }),
                    "text/plain",
                  )
                }
                className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Download className="h-4 w-4" strokeWidth={1.75} />
                .txt
              </button>
            </div>
          </div>

          {context.meta.warnings.length > 0 && (
            <div className="border-b border-border bg-amber-50 px-5 py-3 text-sm text-amber-800">
              {context.meta.warnings.map((warning, i) => (
                <p key={i} className={i > 0 ? "mt-1.5" : undefined}>
                  {warning}
                </p>
              ))}
            </div>
          )}

          {/* The exported text itself, not a nicer rendering of it — the
              point of a preview here is to see exactly what will be pasted. */}
          <pre className="max-h-[32rem] overflow-auto px-5 py-4 text-xs leading-relaxed text-foreground">
            {markdown}
          </pre>
        </div>
      )}
    </div>
  );
}
