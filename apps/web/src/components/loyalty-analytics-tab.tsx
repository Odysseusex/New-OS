"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { LoyaltyAnalyticsDto, LoyaltyAnalyticsMemberRowDto, LoyaltyChurnSettings } from "@bakery-os/shared";
import {
  DEFAULT_LOYALTY_CHURN_SETTINGS,
  formatKzPhone,
  LOYALTY_SEGMENT_LABELS_RU,
  LoyaltySegment,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDayKey, formatMoney } from "@/lib/format";
import { inputClass } from "@/components/loyalty-shared";
import { LoyaltyMemberModal } from "@/components/loyalty-member-modal";

const PERIODS = [7, 30, 90] as const;
const CHURN_STORAGE_KEY = "loyalty-churn-settings";
const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const percent = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_RU[m - 1]} ${y}`;
};

function readChurn(): LoyaltyChurnSettings {
  try {
    const raw = localStorage.getItem(CHURN_STORAGE_KEY);
    return raw ? { ...DEFAULT_LOYALTY_CHURN_SETTINGS, ...JSON.parse(raw) } : DEFAULT_LOYALTY_CHURN_SETTINGS;
  } catch {
    return DEFAULT_LOYALTY_CHURN_SETTINGS;
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function MemberTable({ rows, onOpen, showInterval }: { rows: LoyaltyAnalyticsMemberRowDto[]; onOpen: (id: string) => void; showInterval?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Нет клиентов</p>;
  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-medium">Клиент</th>
            <th className="px-3 py-2 font-medium">Последний визит</th>
            {showInterval && <th className="px-3 py-2 text-right font-medium">Обычно раз в</th>}
            <th className="px-3 py-2 text-right font-medium">Визитов</th>
            <th className="px-3 py-2 text-right font-medium">Выручка</th>
            <th className="px-3 py-2 text-right font-medium">Средний чек</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.memberId} onClick={() => onOpen(r.memberId)} className="cursor-pointer transition hover:bg-surface-muted">
              <td className="px-3 py-2 text-foreground">
                <span className="whitespace-nowrap font-medium">{formatKzPhone(r.phone)}</span>
                {r.name && <span className="text-muted"> · {r.name}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted">
                {formatDate(r.lastVisitAt)} · {r.daysSinceLastVisit} дн. назад
              </td>
              {showInterval && (
                <td className="whitespace-nowrap px-3 py-2 text-right text-muted">
                  {r.usualIntervalDays !== null ? `${Math.round(r.usualIntervalDays)} дн.` : "—"}
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums text-foreground">{r.visits}</td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(r.spend)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{formatMoney(r.averageCheck)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Customer analytics from sales with an attached member. Methods follow leading
// platforms (docs/CRM-LOYALTY-RESEARCH.md §13).
export function LoyaltyAnalyticsTab({ canAdmin }: { canAdmin: boolean }) {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [churn, setChurn] = useState<LoyaltyChurnSettings>(DEFAULT_LOYALTY_CHURN_SETTINGS);
  const [churnDraft, setChurnDraft] = useState<Record<keyof LoyaltyChurnSettings, string>>({ minVisits: "3", windowDays: "60", inactiveDays: "14" });
  const [data, setData] = useState<LoyaltyAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<LoyaltySegment | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const stored = readChurn();
    setChurn(stored);
    setChurnDraft({ minVisits: String(stored.minVisits), windowDays: String(stored.windowDays), inactiveDays: String(stored.inactiveDays) });
  }, []);

  const range = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() };
  }, [days]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.loyalty
      .analytics(range.from, range.to, churn)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить аналитику"))
      .finally(() => setLoading(false));
  }, [range, churn]);

  useEffect(() => {
    load();
  }, [load]);

  function applyChurn() {
    const next = {
      minVisits: Number(churnDraft.minVisits),
      windowDays: Number(churnDraft.windowDays),
      inactiveDays: Number(churnDraft.inactiveDays),
    };
    setChurn(next);
    try {
      localStorage.setItem(CHURN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not remembered on this device; the figures still use it.
    }
  }

  const s = data?.summary;
  const tiles: [string, string][] = s
    ? [
        ["Активных участников", String(s.activeMembers)],
        ["Новых участников", String(s.newMembers)],
        ["Доля вернувшихся", percent(s.returningShare)],
        ["Визитов на участника", s.visitsPerMember === null ? "—" : s.visitsPerMember.toLocaleString("ru-RU")],
        ["Средний чек участников", s.averageCheckMembers === null ? "—" : formatMoney(s.averageCheckMembers)],
        ["Средний чек без карты", s.averageCheckAnonymous === null ? "—" : formatMoney(s.averageCheckAnonymous)],
        ["Выручка участников", formatMoney(s.memberRevenue)],
        ["Доля выручки участников", percent(s.memberRevenueShare)],
      ]
    : [];
  const maxFrequency = Math.max(1, ...(data?.frequency.map((f) => f.members) ?? [1]));
  const segmentRows = data ? data.segments.rows.filter((r) => segment === null || r.segment === segment) : [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1 sm:w-fit">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setDays(p)}
            className={clsx(
              "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
              days === p ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {p} дней
          </button>
        ))}
      </div>

      {error && <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && !data && <p className="text-sm text-muted">Загрузка…</p>}

      {data && (
        <>
          {s && s.memberVisits === 0 && (
            <p className="mb-6 rounded-xl bg-surface-muted px-4 py-3 text-sm text-foreground">
              За период нет продаж с прикреплённым клиентом.
            </p>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <p className="text-xl font-semibold text-foreground">{value}</p>
                <p className="mt-0.5 text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>

          <Card title="Группы клиентов (RFM)">
            {!data.segments.available ? (
              <p className="text-sm text-muted">
                Группы появятся, когда наберётся {data.segments.minimumMembers} клиентов с покупками за год (сейчас{" "}
                {data.segments.membersScored}).
              </p>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {data.segments.groups.map((g) => (
                    <button
                      key={g.segment}
                      onClick={() => setSegment(segment === g.segment ? null : g.segment)}
                      className={clsx(
                        "rounded-xl border px-4 py-3 text-left transition hover:bg-surface-muted",
                        segment === g.segment ? "border-accent ring-2 ring-accent/20" : "border-border",
                      )}
                    >
                      <p className="text-lg font-semibold text-foreground">{g.members}</p>
                      <p className="text-xs font-medium text-foreground">{LOYALTY_SEGMENT_LABELS_RU[g.segment]}</p>
                      <p className="text-xs text-muted">{formatMoney(g.revenue)}</p>
                    </button>
                  ))}
                </div>
                <MemberTable rows={segmentRows} onOpen={setOpenId} />
              </>
            )}
          </Card>

          <Card title="Радар оттока">
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[repeat(3,minmax(0,12rem))_auto] sm:items-end sm:justify-start">
              {(
                [
                  ["minVisits", "Визитов не меньше"],
                  ["windowDays", "За последние, дней"],
                  ["inactiveDays", "Не приходит, дней"],
                ] as [keyof LoyaltyChurnSettings, string][]
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
                  <input
                    inputMode="numeric"
                    value={churnDraft[key]}
                    onChange={(e) => setChurnDraft({ ...churnDraft, [key]: e.target.value })}
                    className={inputClass}
                  />
                </div>
              ))}
              <button
                onClick={applyChurn}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
              >
                Пересчитать
              </button>
            </div>
            <MemberTable rows={data.churnRadar.rows} onOpen={setOpenId} showInterval />
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Частота визитов за период">
              <div className="space-y-2">
                {data.frequency.map((f) => (
                  <div key={f.label} className="grid grid-cols-[5rem_1fr_3rem] items-center gap-3 text-sm" title={`${f.label} визит(ов): ${f.members}`}>
                    <span className="text-muted">{f.label} виз.</span>
                    <div className="h-4 rounded-r bg-surface-muted">
                      <div className="h-4 rounded-r bg-accent" style={{ width: `${(f.members / maxFrequency) * 100}%` }} />
                    </div>
                    <span className="text-right tabular-nums text-foreground">{f.members}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Новые и вернувшиеся по неделям">
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 font-medium">Неделя с</th>
                      <th className="py-2 text-right font-medium">Новые</th>
                      <th className="py-2 text-right font-medium">Вернувшиеся</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...data.weekly].reverse().map((w) => (
                      <tr key={w.weekStart}>
                        <td className="py-2 text-muted">{formatDayKey(w.weekStart)}</td>
                        <td className="py-2 text-right tabular-nums text-foreground">{w.newMembers}</td>
                        <td className="py-2 text-right tabular-nums text-foreground">{w.returningMembers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title="Когорты удержания">
            {data.cohorts.length === 0 ? (
              <p className="text-sm text-muted">Нет клиентов с первой покупкой за последние полгода</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 pr-3 font-medium">Месяц первой покупки</th>
                      <th className="py-2 pr-3 text-right font-medium">Клиентов</th>
                      {["Через 1 мес.", "Через 2 мес.", "Через 3 мес."].map((h) => (
                        <th key={h} className="px-1 py-2 text-center font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohorts.map((c) => (
                      <tr key={c.month} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 text-foreground">{monthLabel(c.month)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-foreground">{c.size}</td>
                        {c.retention.map((r, i) => (
                          <td key={i} className="px-1 py-1.5">
                            {r === null ? (
                              <div className="rounded-lg px-2 py-1.5 text-center text-muted">—</div>
                            ) : (
                              <div className="relative overflow-hidden rounded-lg bg-surface-muted px-2 py-1.5 text-center">
                                <div className="absolute inset-0 bg-accent" style={{ opacity: 0.1 + r * 0.45 }} />
                                <span className="relative font-medium tabular-nums text-foreground">{percent(r)}</span>
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Лучшие клиенты за период">
            <MemberTable rows={data.topMembers} onOpen={setOpenId} />
          </Card>
        </>
      )}

      {openId && (
        <LoyaltyMemberModal memberId={openId} canManage canAdmin={canAdmin} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
}
