"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Sparkles, TrendingDown, TrendingUp, X } from "lucide-react";
import type { AiExecutiveSummaryDto, AiInsightDto, AiLocationDeviationResponseDto } from "@bakery-os/shared";
import { AI_INSIGHT_CATEGORY_LABELS_RU, AiInsightCategory } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { AiPriorityChip } from "@/components/ai-priority-chip";
import { AiConfidenceBadge } from "@/components/ai-confidence-badge";

type Tab = "summary" | "priorities" | "locations";

const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Сводка" },
  { key: "priorities", label: "Приоритеты" },
  { key: "locations", label: "Сравнение точек" },
];

export default function AiCenterPage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<AiExecutiveSummaryDto | null>(null);
  const [insights, setInsights] = useState<AiInsightDto[] | null>(null);
  const [locations, setLocations] = useState<AiLocationDeviationResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(() => {
    api.ai.summary().then(setSummary).catch(() => setError("Не удалось загрузить сводку"));
  }, []);
  const loadInsights = useCallback(() => {
    api.ai
      .insights()
      .then((r) => setInsights(r.insights))
      .catch(() => setError("Не удалось загрузить приоритеты"));
  }, []);
  const loadLocations = useCallback(() => {
    api.ai.locations().then(setLocations).catch(() => setError("Не удалось загрузить сравнение точек"));
  }, []);

  useEffect(() => {
    loadSummary();
    loadInsights();
  }, [loadSummary, loadInsights]);

  useEffect(() => {
    if (tab === "locations" && !locations) loadLocations();
  }, [tab, locations, loadLocations]);

  async function handleDismiss(key: string) {
    setInsights((prev) => prev?.filter((i) => i.key !== key) ?? null);
    try {
      await api.ai.dismiss(key);
    } catch {
      loadInsights();
    }
  }

  async function handleDismissAll() {
    if (!insights || insights.length === 0) return;
    if (!confirm("Скрыть все текущие карточки? Если ситуация ухудшится, они появятся снова.")) return;
    const previous = insights;
    setInsights([]);
    try {
      await api.ai.dismissAll();
    } catch {
      setInsights(previous);
      setError("Не удалось скрыть карточки");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" strokeWidth={1.75} />
            <h1 className="text-xl font-semibold text-foreground">AI-центр</h1>
          </div>
          <p className="text-sm text-muted">
            Аналитика на основе данных ArAmir OS — приоритеты, отклонения и сравнение точек. Этап 1: без
            LLM, все выводы вычисляются кодом.
          </p>
        </div>
      </div>

      {error && <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-6 flex items-center gap-1 rounded-xl bg-surface-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
              tab === t.key ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {t.label}
            {t.key === "priorities" && insights && insights.length > 0 && (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
                {insights.length}
              </span>
            )}
          </button>
        ))}
        <span className="ml-1 flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm text-muted opacity-60">
          Прогнозы <span className="text-xs italic">скоро</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm text-muted opacity-60">
          Спросить AI <span className="text-xs italic">скоро</span>
        </span>
      </div>

      {tab === "summary" && (
        <SummaryTab
          summary={summary}
          insights={insights}
          onOpenPriorities={() => setTab("priorities")}
          onDismiss={handleDismiss}
        />
      )}

      {tab === "priorities" && (
        <PrioritiesTab insights={insights} onDismiss={handleDismiss} onDismissAll={handleDismissAll} />
      )}

      {tab === "locations" && <LocationsTab data={locations} />}
    </div>
  );
}

function SummaryTab({
  summary,
  insights,
  onOpenPriorities,
  onDismiss,
}: {
  summary: AiExecutiveSummaryDto | null;
  insights: AiInsightDto[] | null;
  onOpenPriorities: () => void;
  onDismiss: (key: string) => void;
}) {
  const topInsights = (insights ?? []).slice(0, 5);

  return (
    <div>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {!summary && Array.from({ length: 5 }).map((_, i) => <MetricTileSkeleton key={i} />)}
        {summary?.metrics.map((m) => <MetricTile key={m.key} metric={m} />)}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Главные приоритеты</h2>
        {insights && insights.length > 5 && (
          <button onClick={onOpenPriorities} className="text-sm text-accent hover:opacity-80">
            Смотреть все ({insights.length}) →
          </button>
        )}
      </div>

      {insights && topInsights.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
          Поводов для внимания сейчас нет.
        </p>
      )}

      <div className="space-y-3">
        {topInsights.map((insight) => (
          <InsightCard key={insight.key} insight={insight} onDismiss={onDismiss} compact />
        ))}
      </div>
    </div>
  );
}

function MetricTile({ metric }: { metric: AiExecutiveSummaryDto["metrics"][number] }) {
  const value = metric.unit === "money" ? formatMoney(metric.value) : `${metric.value.toFixed(1)}%`;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="mb-1 text-xs text-muted">{metric.label}</p>
      <p className="mb-1.5 text-lg font-semibold text-foreground">{value}</p>
      {metric.deltaPct === null ? (
        <p className="text-xs text-muted">нет данных для сравнения</p>
      ) : (
        <p
          className={clsx(
            "flex items-center gap-1 text-xs font-medium",
            metric.deltaPct >= 0 ? "text-emerald-600" : "text-red-600",
          )}
        >
          {metric.deltaPct >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {metric.deltaPct >= 0 ? "+" : ""}
          {metric.deltaPct.toFixed(1)}
          {metric.unit === "percent" ? " п.п." : "%"}
        </p>
      )}
    </div>
  );
}

function MetricTileSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-2 h-3 w-16 animate-pulse rounded bg-surface-muted" />
      <div className="mb-2 h-5 w-24 animate-pulse rounded bg-surface-muted" />
      <div className="h-3 w-12 animate-pulse rounded bg-surface-muted" />
    </div>
  );
}

const CATEGORY_FILTERS: (AiInsightCategory | "ALL")[] = ["ALL", ...Object.values(AiInsightCategory)];

function PrioritiesTab({
  insights,
  onDismiss,
  onDismissAll,
}: {
  insights: AiInsightDto[] | null;
  onDismiss: (key: string) => void;
  onDismissAll: () => void;
}) {
  const [filter, setFilter] = useState<AiInsightCategory | "ALL">("ALL");

  const present = new Set((insights ?? []).map((i) => i.category));
  const availableFilters = CATEGORY_FILTERS.filter((f) => f === "ALL" || present.has(f));
  const filtered = (insights ?? []).filter((i) => filter === "ALL" || i.category === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {availableFilters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                filter === f ? "bg-accent text-accent-foreground" : "bg-surface-muted text-muted hover:text-foreground",
              )}
            >
              {f === "ALL" ? "Все" : AI_INSIGHT_CATEGORY_LABELS_RU[f]}
            </button>
          ))}
        </div>
        {insights && insights.length > 0 && (
          <button onClick={onDismissAll} className="text-xs text-muted hover:text-foreground">
            Скрыть все
          </button>
        )}
      </div>

      {insights && filtered.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
          {insights.length === 0 ? "Поводов для внимания сейчас нет." : "Нет карточек в этой категории."}
        </p>
      )}

      <div className="space-y-3">
        {filtered.map((insight) => (
          <InsightCard key={insight.key} insight={insight} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function InsightCard({
  insight,
  onDismiss,
  compact = false,
}: {
  insight: AiInsightDto;
  onDismiss: (key: string) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(!compact);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">{AI_INSIGHT_CATEGORY_LABELS_RU[insight.category]}</p>
          <h3 className="text-sm font-semibold text-foreground">{insight.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AiPriorityChip priority={insight.priority} />
          <button
            onClick={() => onDismiss(insight.key)}
            title="Скрыть"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {compact ? (
        <p className="text-sm text-muted">{insight.facts[0]}</p>
      ) : (
        <div className="space-y-1.5">
          {insight.facts.map((fact, i) => (
            <p key={i} className="text-sm text-foreground">
              {fact}
            </p>
          ))}
        </div>
      )}

      {expanded && insight.hypothesis && (
        <p className="mt-2.5 rounded-lg bg-surface-muted px-3 py-2 text-xs italic text-muted">
          Предположение: {insight.hypothesis}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-3">
          <AiConfidenceBadge confidence={insight.confidence} />
          {insight.locationName && <span className="text-xs text-muted">· {insight.locationName}</span>}
        </div>
        <div className="flex items-center gap-3">
          {compact && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              {expanded ? (
                <>
                  Свернуть <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                </>
              ) : (
                <>
                  Подробнее <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                </>
              )}
            </button>
          )}
          <Link href={insight.link} className="text-xs font-medium text-accent hover:opacity-80">
            Перейти →
          </Link>
        </div>
      </div>
    </div>
  );
}

function LocationsTab({ data }: { data: AiLocationDeviationResponseDto | null }) {
  if (!data) {
    return <p className="py-8 text-center text-sm text-muted">Загрузка…</p>;
  }

  const sorted = [...data.locations].sort((a, b) => Math.abs(b.revenueDeviationPct) - Math.abs(a.revenueDeviationPct));

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Медиана по сети за период: выручка {formatMoney(data.networkMedianRevenue)}, средний чек{" "}
        {formatMoney(data.networkMedianAverageTicket)}.
      </p>
      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Точка</th>
              <th className="px-5 py-3 text-right font-medium">Выручка</th>
              <th className="px-5 py-3 text-right font-medium">Отклонение</th>
              <th className="px-5 py-3 text-right font-medium">Средний чек</th>
              <th className="px-5 py-3 text-right font-medium">Низкие остатки</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((loc) => (
              <tr key={loc.locationId}>
                <td className="px-5 py-3 font-medium text-foreground">
                  <div className="flex items-center gap-2">
                    {loc.locationName}
                    {loc.isOutlier && loc.confidence !== "LOW" && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        отклонение
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-right text-foreground">{formatMoney(loc.revenue)}</td>
                <td
                  className={clsx(
                    "px-5 py-3 text-right font-medium",
                    loc.revenueDeviationPct >= 0 ? "text-emerald-600" : "text-red-600",
                  )}
                >
                  {loc.revenueDeviationPct >= 0 ? "+" : ""}
                  {loc.revenueDeviationPct.toFixed(0)}%
                </td>
                <td className="px-5 py-3 text-right text-muted">{formatMoney(loc.averageTicket)}</td>
                <td className="px-5 py-3 text-right text-muted">{loc.lowStockCount}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                  Нет данных за период
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
