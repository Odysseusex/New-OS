"use client";

import { useEffect, useState } from "react";
import type { LoyaltySettingsDto, LoyaltyWhatsAppStatusDto } from "@bakery-os/shared";
import { LOYALTY_WHATSAPP_TEMPLATE_STATUS_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";

const QUALITY_RU: Record<string, string> = { GREEN: "высокое", YELLOW: "среднее", RED: "низкое" };
const CATEGORY_RU = { UTILITY: "Сервисное", MARKETING: "Рекламное" } as const;
const TOGGLES: [keyof Pick<LoyaltySettingsDto, "whatsappSaleNotices" | "whatsappExpiryNotices" | "whatsappBirthdayNotices">, string][] = [
  ["whatsappSaleNotices", "после покупки и возврата"],
  ["whatsappExpiryNotices", "баллы скоро сгорят"],
  ["whatsappBirthdayNotices", "поздравление с днём рождения"],
];

// WhatsApp on the programme card: connection, which notices go there, Meta's
// verdict on our message templates and, for owner/admin, what to paste into
// Meta's webhook form.
export function LoyaltyWhatsAppBlock({
  settings,
  canEdit,
  busy,
  onSave,
  refreshKey,
}: {
  settings: LoyaltySettingsDto | null;
  canEdit: boolean;
  busy: boolean;
  onSave: (patch: Partial<LoyaltySettingsDto>) => void;
  refreshKey: number;
}) {
  const [status, setStatus] = useState<LoyaltyWhatsAppStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.loyalty
      .whatsappStatus()
      .then((s) => {
        setStatus(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Не удалось узнать состояние WhatsApp"));
  }, [refreshKey]);

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const templates = await api.loyalty.whatsappSubmitTemplates();
      setStatus((s) => (s ? { ...s, templates } : s));
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Не удалось отправить шаблоны в Meta");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <p className="mb-4 text-sm text-red-700">{loadError}</p>;
  if (!status) return null;

  if (!status.configured) {
    return (
      <p className="mb-4 text-sm text-muted">
        WhatsApp не подключён{status.missingSettings.length > 0 && canEdit ? `. Не заданы: ${status.missingSettings.join(", ")}` : "."}
      </p>
    );
  }

  const { SENT, DELIVERED, READ, FAILED } = status.last30Days;
  const total = SENT + DELIVERED + READ + FAILED;
  const missing = status.templates.some((t) => t.status === "MISSING");

  return (
    <div className="mb-4 space-y-2 text-sm text-foreground">
      <p>
        WhatsApp: <span className="font-medium">{status.phone ?? "номер не прочитан"}</span>
        {status.verifiedName && ` · ${status.verifiedName}`}
        {status.qualityRating && QUALITY_RU[status.qualityRating] && <span className="text-muted"> · качество номера: {QUALITY_RU[status.qualityRating]}</span>}
        <span className="text-muted"> · получают рассылки {status.reachableMembers}</span>
      </p>
      {status.problem && <p className="text-red-700">{status.problem}</p>}

      {settings && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted">Отправлять в WhatsApp:</span>
          {TOGGLES.map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings[key]} disabled={!canEdit || busy} onChange={(e) => onSave({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      )}

      <p className="text-muted">
        За 30 дней: отправлено {total} · доставлено {DELIVERED + READ} · прочитано {READ} · не доставлено {FAILED}
      </p>

      <details className="rounded-xl border border-border px-4 py-2">
        <summary className="cursor-pointer select-none font-medium">
          Шаблоны сообщений · одобрено {status.templates.filter((t) => t.status === "APPROVED").length} из {status.templates.length}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Сообщение</th>
                <th className="py-2 pr-3 font-medium">Текст</th>
                <th className="py-2 pr-3 font-medium">Вид</th>
                <th className="py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {status.templates.map((t) => (
                <tr key={t.name} className="align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{t.purpose}</td>
                  <td className="py-2 pr-3 whitespace-pre-line text-muted">{t.text}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted">{CATEGORY_RU[t.category]}</td>
                  <td className={`py-2 whitespace-nowrap font-medium ${t.status === "APPROVED" ? "text-emerald-700" : t.status === "REJECTED" ? "text-red-700" : "text-foreground"}`}>
                    {LOYALTY_WHATSAPP_TEMPLATE_STATUS_LABELS_RU[t.status]}
                    {t.rejectedReason && <span className="block text-xs font-normal text-muted">{t.rejectedReason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && missing && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "Отправка…" : "Отправить шаблоны на проверку в Meta"}
            </button>
            {submitError && <span className="text-red-700">{submitError}</span>}
          </div>
        )}
      </details>

      {(status.webhookUrl || status.verifyToken) && (
        <details className="rounded-xl border border-border px-4 py-2">
          <summary className="cursor-pointer select-none font-medium">Webhook для Meta</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Callback URL</dt>
            <dd className="break-all font-mono text-xs">{status.webhookUrl ?? "не задан адрес сервера (RENDER_EXTERNAL_URL)"}</dd>
            <dt className="text-muted">Verify token</dt>
            <dd className="break-all font-mono text-xs">{status.verifyToken ?? "—"}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}
