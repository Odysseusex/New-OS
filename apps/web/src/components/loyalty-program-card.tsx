"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { LoyaltySettingsDto, LoyaltySummaryDto, LoyaltyTelegramStatusDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoneyPrecise, formatPoints } from "@/lib/format";
import { inputClass } from "@/components/loyalty-shared";
import { Modal } from "@/components/modal";
import { LoyaltyWhatsAppBlock } from "@/components/loyalty-whatsapp-block";

const PERIOD_DAYS = 30;

type NumericSetting =
  | "welcomeBonusPoints"
  | "welcomeBonusDelayDays"
  | "welcomeBonusDays"
  | "firstPurchaseEarnPercent"
  | "earnPercent" | "maxRedeemPercent" | "pointsLifetimeMonths" | "birthdayBonusPoints" | "birthdayBonusDays"
  | "silverThreshold" | "silverPercent" | "goldThreshold" | "goldPercent" | "tierWindowDays" | "tierHoldDays";

// Programme settings (owner/admin edit them) and the points figures. Points
// are a discount when spent («способ Б»), so «Баллов у клиентов» is shown here
// for information only — it is not a liability in the books.
export function LoyaltyProgramCard({ canEdit, refreshKey }: { canEdit: boolean; refreshKey: number }) {
  const [settings, setSettings] = useState<LoyaltySettingsDto | null>(null);
  const [draft, setDraft] = useState<Record<NumericSetting, string> | null>(null);
  const [summary, setSummary] = useState<LoyaltySummaryDto | null>(null);
  const [telegram, setTelegram] = useState<LoyaltyTelegramStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const range = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - PERIOD_DAYS * 86_400_000).toISOString(), to: to.toISOString() };
  }, []);

  const fill = useCallback((s: LoyaltySettingsDto) => {
    setSettings(s);
    setDraft({
      welcomeBonusPoints: String(s.welcomeBonusPoints),
      welcomeBonusDelayDays: String(s.welcomeBonusDelayDays),
      welcomeBonusDays: String(s.welcomeBonusDays),
      firstPurchaseEarnPercent: String(s.firstPurchaseEarnPercent),
      earnPercent: String(s.earnPercent),
      maxRedeemPercent: String(s.maxRedeemPercent),
      pointsLifetimeMonths: String(s.pointsLifetimeMonths),
      birthdayBonusPoints: String(s.birthdayBonusPoints),
      birthdayBonusDays: String(s.birthdayBonusDays),
      silverThreshold: String(s.silverThreshold),
      silverPercent: String(s.silverPercent),
      goldThreshold: String(s.goldThreshold),
      goldPercent: String(s.goldPercent),
      tierWindowDays: String(s.tierWindowDays),
      tierHoldDays: String(s.tierHoldDays),
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
    ["welcomeBonusPoints", "Бонус за первую покупку, ₸"],
    ["welcomeBonusDelayDays", "Бонус за первую покупку доступен через, дней"],
    ["welcomeBonusDays", "Бонус за первую покупку действует, дней"],
    ["firstPurchaseEarnPercent", "Начисление за первую покупку, %"],
    ["earnPercent", "Начисление за покупку, %"],
    ["maxRedeemPercent", "Оплата баллами, не больше % чека"],
    ["pointsLifetimeMonths", "Срок жизни баллов за покупки, мес."],
    ["birthdayBonusPoints", "Подарок на день рождения, баллов"],
    ["birthdayBonusDays", "Подарок действует, дней"],
  ];
  const changed = settings && draft ? fields.some(([key]) => num(draft[key]) !== settings[key]) : false;
  // Levels: the earn percent by the member's own spend over the window.
  const tierFields: [keyof NonNullable<typeof draft>, string][] = [
    ["silverThreshold", "Серебро: покупки от, ₸"],
    ["silverPercent", "Серебро: начисление, %"],
    ["goldThreshold", "Золото: покупки от, ₸"],
    ["goldPercent", "Золото: начисление, %"],
    ["tierWindowDays", "Покупки считаются за, дней"],
    ["tierHoldDays", "Уровень сохраняется не меньше, дней"],
  ];
  const tiersChanged = settings && draft ? tierFields.some(([key]) => num(draft[key]) !== settings[key]) : false;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Бонусная программа</h2>
        <a href="/poster" target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">
          Плакат с QR для кассы (A4)
        </a>
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
              </span>{" "}
              <button type="button" onClick={() => setQrOpen(true)} className="font-medium text-accent hover:underline">
                QR-код для кассы
              </button>
            </>
          ) : (
            <span className={telegram.problem ? "text-red-700" : "text-muted"}>
              Telegram-бот для клиентов не подключён{telegram.problem ? `: ${telegram.problem}` : "."}
            </span>
          )}
        </p>
      )}

      <LoyaltyWhatsAppBlock settings={settings} canEdit={canEdit} busy={busy} onSave={save} refreshKey={refreshKey} />

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end lg:grid-cols-5">
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
          {num(draft.welcomeBonusPoints) > 0 && (
            <p className="text-xs text-muted sm:col-span-3 lg:col-span-5">
              За первую покупку начисляется бонус {draft.welcomeBonusPoints} ₸ вместо процента.
            </p>
          )}
          {canEdit && (
            <button
              disabled={!changed || busy}
              onClick={() =>
                save(Object.fromEntries(fields.map(([key]) => [key, num(draft[key])])) as Partial<LoyaltySettingsDto>)
              }
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {saved && !changed ? "Сохранено" : "Сохранить"}
            </button>
          )}
        </div>
      )}
      {settings && draft && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Уровни</h3>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={settings.tiersEnabled}
                disabled={!canEdit || busy}
                onChange={(e) => save({ tiersEnabled: e.target.checked })}
              />
              Уровни включены
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end lg:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Базовый: начисление, %</label>
              <input value={draft.earnPercent} disabled className={inputClass} />
            </div>
            {tierFields.map(([key, label]) => (
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
                disabled={!tiersChanged || busy}
                onClick={() => save(Object.fromEntries(tierFields.map(([key]) => [key, num(draft[key])])) as Partial<LoyaltySettingsDto>)}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {saved && !tiersChanged ? "Сохранено" : "Сохранить"}
              </button>
            )}
          </div>
        </div>
      )}
      {qrOpen && telegram?.username && <BotQrModal username={telegram.username} onClose={() => setQrOpen(false)} />}
    </div>
  );
}

// A sign for the counter: scanning it opens the customer bot. Black on white
// like the receipt QR — it has to survive a phone camera, so it is not themed.
function BotQrModal({ username, onClose }: { username: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const url = `https://t.me/${username}`;

  function print() {
    const svg = ref.current?.querySelector("svg")?.outerHTML;
    const win = window.open("", "_blank", "width=600,height=800");
    if (!svg || !win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Бонусы в Telegram</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin:48px;color:#000;background:#fff}
h1{font-size:30px;margin:0 0 12px}p{font-size:20px;margin:8px 0}svg{width:320px;height:320px;margin:28px 0}</style></head>
<body><h1>Ваши бонусы — в Telegram</h1><p>Наведите камеру телефона на код</p>${svg}<p><b>@${username}</b></p>
<p>Баланс баллов, начисления и подарки</p></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <Modal title="QR-код Telegram-бота" onClose={onClose}>
      <div className="flex flex-col items-center gap-3">
        <div ref={ref} className="rounded-xl bg-white p-4">
          <QRCodeSVG value={url} size={240} bgColor="#ffffff" fgColor="#000000" />
        </div>
        <p className="text-sm text-foreground">@{username}</p>
        <button
          type="button"
          onClick={print}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
        >
          Печать
        </button>
      </div>
    </Modal>
  );
}
