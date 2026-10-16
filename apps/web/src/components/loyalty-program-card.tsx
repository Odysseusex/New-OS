"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoyaltySettingsDto, LoyaltySummaryDto, LoyaltyTelegramStatusDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoneyPrecise, formatPoints } from "@/lib/format";
import { inputClass } from "@/components/loyalty-shared";

const PERIOD_DAYS = 30;

// Programme settings (owner/admin edit them) and the points figures. Points
// are a discount when spent («способ Б»), so «Баллов у клиентов» is shown here
// for information only — it is not a liability in the books.
export function LoyaltyProgramCard({ canEdit, refreshKey }: { canEdit: boolean; refreshKey: number }) {
  const [settings, setSettings] = useState<LoyaltySettingsDto | null>(null);
  const [draft, setDraft] = useState<Record<keyof Omit<LoyaltySettingsDto, "enabled">, string> | null>(null);
  const [summary, setSummary] = useState<LoyaltySummaryDto | null>(null);
  const [telegram, setTelegram] = useState<LoyaltyTelegramStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const range = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - PERIOD_DAYS * 86_400_000).toISOString(), to: to.toISOString() };
  }, []);

  const fill = useCallback((s: LoyaltySettingsDto) => {
    setSettings(s);
    setDraft({
      firstPurchaseEarnPercent: String(s.firstPurchaseEarnPercent),
      earnPercent: String(s.earnPercent),
      maxRedeemPercent: String(s.maxRedeemPercent),
      pointsLifetimeMonths: String(s.pointsLifetimeMonths),
    });
  }, []);

  useEffect(() => {
    api.loyalty
      .settings()
      .then(fill)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить настройки программы"));
  }, [fill]);

  useEffect(() => {
    api.loyalty
      .telegramStatus()
      .then(setTelegram)
      .catch(() => setTelegram(null));
  }, [refreshKey]);

  useEffect(() => {
    api.loyalty
      .summary(range.from, range.to)
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить итоги по баллам"));
  }, [range, refreshKey]);

  async function save(patch: Partial<LoyaltySettingsDto>) {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      fill(await api.loyalty.updateSettings(patch));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }

  const num = (v: string) => Number(v.replace(",", "."));
  const changed =
    settings && draft
      ? num(draft.firstPurchaseEarnPercent) !== settings.firstPurchaseEarnPercent ||
        num(draft.earnPercent) !== settings.earnPercent ||
        num(draft.maxRedeemPercent) !== settings.maxRedeemPercent ||
        num(draft.pointsLifetimeMonths) !== settings.pointsLifetimeMonths
      : false;

  const stats: [string, string][] = summary
    ? [
        ["Баллов у клиентов", formatMoneyPrecise(summary.pointsOutstanding)],
        ["Клиентов с баллами", String(summary.membersWithPoints)],
        [`Начислено за ${PERIOD_DAYS} дней`, formatPoints(summary.pointsEarned)],
        [`Скидки баллами за ${PERIOD_DAYS} дней`, formatMoneyPrecise(summary.pointsRedeemed)],
        [`Сгорело за ${PERIOD_DAYS} дней`, formatPoints(summary.pointsExpired)],
      ]
    : [];

  const fields: [keyof NonNullable<typeof draft>, string][] = [
    ["firstPurchaseEarnPercent", "Начисление за первую покупку, %"],
    ["earnPercent", "Начисление за покупку, %"],
    ["maxRedeemPercent", "Оплата баллами, не больше % чека"],
    ["pointsLifetimeMonths", "Срок жизни баллов, мес."],
  ];

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Бонусная программа</h2>
        {settings && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!canEdit || busy}
              onChange={(e) => save({ enabled: e.target.checked })}
            />
            Программа включена
          </label>
        )}
      </div>

      {settings && !settings.enabled && (
        <p className="mb-4 rounded-xl bg-surface-muted px-4 py-2 text-sm text-foreground">
          Программа выключена: на кассе баллы не начисляются и не списываются.
        </p>
      )}
      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {telegram && (
        <p className="mb-4 text-sm text-foreground">
          {telegram.enabled && telegram.username ? (
            <>
              Telegram-бот для клиентов:{" "}
              <a href={`https://t.me/${telegram.username}`} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                @{telegram.username}
              </a>{" "}
              <span className="text-muted">
                · подключено {telegram.linkedMembers}, получают уведомления {telegram.reachableMembers}
              </span>
            </>
          ) : (
            <span className="text-muted">Telegram-бот для клиентов не подключён.</span>
          )}
        </p>
      )}

      {stats.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border px-4 py-3">
              <p className="text-lg font-semibold text-foreground">{value}</p>
              <p className="text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(4,1fr)_auto] sm:items-end">
          {fields.map(([key, label]) => (
            <div key={key}>
              <label className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
              <input
                inputMode="decimal"
                value={draft[key]}
                disabled={!canEdit}
                onChange={(e) => {
                  setSaved(false);
                  setDraft({ ...draft, [key]: e.target.value });
                }}
                className={inputClass}
              />
            </div>
          ))}
          {canEdit && (
            <button
              disabled={!changed || busy}
              onClick={() =>
                save({
                  firstPurchaseEarnPercent: num(draft.firstPurchaseEarnPercent),
                  earnPercent: num(draft.earnPercent),
                  maxRedeemPercent: num(draft.maxRedeemPercent),
                  pointsLifetimeMonths: num(draft.pointsLifetimeMonths),
                })
              }
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {saved && !changed ? "Сохранено" : "Сохранить"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
