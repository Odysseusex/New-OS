"use client";

import { useCallback, useEffect, useState } from "react";
import type { LoyaltyMemberDetailDto, LoyaltyMemberDto } from "@bakery-os/shared";
import {
  formatKzPhone,
  KZ_PHONE_INVALID_MESSAGE,
  LOYALTY_CONSENT_CHANNEL_LABELS_RU,
  LOYALTY_CONSENT_CHANNELS,
  LOYALTY_CONSENT_PURPOSE_LABELS_RU,
  LOYALTY_CONSENT_SOURCE_LABELS_RU,
  LOYALTY_POINTS_ENTRY_TYPE_LABELS_RU,
  LoyaltyConsentChannel,
  LoyaltyConsentPurpose,
  LoyaltyConsentSource,
  LoyaltyMemberStatus,
  normalizeKzPhone,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime, formatPoints } from "@/lib/format";
import { Modal } from "@/components/modal";
import { LoyaltyFamilySection } from "@/components/loyalty-family-section";
import { ConsentSourceSelect, inputClass, MemberStatusBadge } from "@/components/loyalty-shared";

type PendingChange = { purpose: LoyaltyConsentPurpose; channel?: LoyaltyConsentChannel; granted: boolean };

export function LoyaltyMemberModal({
  memberId,
  canManage,
  canAdmin,
  onClose,
  onChanged,
}: {
  memberId: string;
  canManage: boolean;
  canAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [currentId, setCurrentId] = useState(memberId);
  const [member, setMember] = useState<LoyaltyMemberDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pending, setPending] = useState<PendingChange | null>(null);
  const [source, setSource] = useState<LoyaltyConsentSource>(LoyaltyConsentSource.AT_TILL);
  const [consentNote, setConsentNote] = useState("");

  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const [mergePhone, setMergePhone] = useState("");
  const [mergeCandidate, setMergeCandidate] = useState<LoyaltyMemberDto | null>(null);
  const [mergeReason, setMergeReason] = useState("");

  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const load = useCallback(() => {
    setLoadError(null);
    api.loyalty
      .findOne(currentId)
      .then((m) => {
        setMember(m);
        setName(m.name ?? "");
        setNote(m.note ?? "");
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить клиента"));
  }, [currentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
      load();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitConsent() {
    if (!pending) return;
    const ok = await run(
      () => api.loyalty.recordConsent(currentId, { ...pending, source, note: consentNote || undefined }),
      "Не удалось записать решение клиента",
    );
    if (ok) {
      setPending(null);
      setConsentNote("");
    }
  }

  async function findMergeCandidate() {
    setError(null);
    setMergeCandidate(null);
    if (!normalizeKzPhone(mergePhone)) {
      setError(KZ_PHONE_INVALID_MESSAGE);
      return;
    }
    try {
      const found = await api.loyalty.lookup(mergePhone);
      if (!found.member) setError(`Клиент с номером ${formatKzPhone(found.phone)} не найден`);
      else if (found.member.id === currentId) setError("Это та же запись");
      else setMergeCandidate(found.member);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось найти клиента");
    }
  }

  async function submitMerge() {
    if (!mergeCandidate) return;
    const ok = await run(
      () => api.loyalty.merge({ primaryId: currentId, duplicateId: mergeCandidate.id, reason: mergeReason }),
      "Не удалось объединить записи",
    );
    if (ok) {
      setMergeCandidate(null);
      setMergePhone("");
      setMergeReason("");
    }
  }

  async function submitAdjust() {
    const points = Number(adjustPoints.replace(",", "."));
    const ok = await run(() => api.loyalty.adjustPoints(currentId, { points, reason: adjustReason }), "Не удалось изменить баллы");
    if (ok) {
      setAdjustPoints("");
      setAdjustReason("");
    }
  }

  const isMerged = member?.status === LoyaltyMemberStatus.MERGED;
  const editable = member !== null && !isMerged;

  function consentRow(label: string, granted: boolean, change: PendingChange, disabled = false) {
    const isPending = pending && pending.purpose === change.purpose && pending.channel === change.channel;
    return (
      <div key={label} className="flex items-center justify-between gap-3 py-2">
        <span className="text-sm text-foreground">{label}</span>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${granted ? "text-emerald-700" : "text-muted"}`}>{granted ? "Дано" : "Нет"}</span>
          {editable && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => setPending(isPending ? null : change)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
            >
              {granted ? "Отозвать" : "Оформить"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal title="Розничный клиент" onClose={onClose} width="max-w-2xl">
      {loadError && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>}
      {!member && !loadError && <p className="text-sm text-muted">Загрузка…</p>}

      {member && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-lg font-semibold text-foreground">{formatKzPhone(member.phone)}</p>
            <MemberStatusBadge status={member.status} />
            <span className="text-sm text-muted">с {formatDate(member.createdAt)}</span>
            <span className="basis-full text-sm text-muted">
              Telegram: {member.telegramLinked ? (member.consents.marketing.TELEGRAM ? "подключён, уведомления включены" : "подключён, уведомления выключены") : "не подключён"}
            </span>
          </div>

          {isMerged && member.mergedIntoId && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-foreground">
              <span>Запись объединена с основной записью клиента</span>
              <button type="button" onClick={() => setCurrentId(member.mergedIntoId as string)} className="font-medium text-accent hover:underline">
                Открыть основную
              </button>
            </div>
          )}

          {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {canManage && editable ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Имя</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Примечание</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
              </div>
              <button
                type="button"
                disabled={busy || (name === (member.name ?? "") && note === (member.note ?? ""))}
                onClick={() => run(() => api.loyalty.update(currentId, { name, note }), "Не удалось сохранить")}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                Сохранить
              </button>
            </div>
          ) : (
            <div className="text-sm text-foreground">
              <p>{member.name ?? "Имя не указано"}</p>
              {member.note && <p className="text-muted">{member.note}</p>}
            </div>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-foreground">Согласия</h3>
            <div className="divide-y divide-border rounded-xl border border-border px-4">
              {consentRow(LOYALTY_CONSENT_PURPOSE_LABELS_RU.PERSONAL_DATA, member.consents.personalData, {
                purpose: LoyaltyConsentPurpose.PERSONAL_DATA,
                granted: !member.consents.personalData,
              })}
              {LOYALTY_CONSENT_CHANNELS.map((channel) =>
                consentRow(
                  `${LOYALTY_CONSENT_PURPOSE_LABELS_RU.MARKETING} · ${LOYALTY_CONSENT_CHANNEL_LABELS_RU[channel]}`,
                  member.consents.marketing[channel],
                  { purpose: LoyaltyConsentPurpose.MARKETING, channel, granted: !member.consents.marketing[channel] },
                  !member.consents.personalData && !member.consents.marketing[channel],
                ),
              )}
            </div>

            {pending && (
              <div className="mt-3 rounded-xl border border-border bg-surface-muted p-4">
                <p className="mb-3 text-sm font-medium text-foreground">
                  {pending.granted ? "Оформить согласие" : "Отозвать согласие"}:{" "}
                  {pending.channel
                    ? `${LOYALTY_CONSENT_PURPOSE_LABELS_RU.MARKETING} · ${LOYALTY_CONSENT_CHANNEL_LABELS_RU[pending.channel]}`
                    : LOYALTY_CONSENT_PURPOSE_LABELS_RU[pending.purpose]}
                </p>
                {pending.purpose === LoyaltyConsentPurpose.PERSONAL_DATA && !pending.granted && (
                  <p className="mb-3 text-sm text-red-700">Клиент выйдет из программы, все рассылки будут отключены.</p>
                )}
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Как получено</label>
                    <ConsentSourceSelect value={source} onChange={setSource} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Примечание</label>
                    <input value={consentNote} onChange={(e) => setConsentNote(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPending(null)} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface">
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={submitConsent}
                    className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
                  >
                    Записать
                  </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-foreground">Баллы</h3>
              <p className="text-lg font-semibold text-foreground">{formatPoints(member.pointsBalance)}</p>
            </div>
            {member.pointsHistory.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-3 py-2 font-medium">Дата</th>
                      <th className="px-3 py-2 font-medium">Операция</th>
                      <th className="px-3 py-2 text-right font-medium">Баллы</th>
                      <th className="px-3 py-2 font-medium">Сгорят</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {member.pointsHistory.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(e.createdAt)}</td>
                        <td className="px-3 py-2 text-foreground">
                          {LOYALTY_POINTS_ENTRY_TYPE_LABELS_RU[e.type]}
                          {e.ratePercent !== null && <span className="text-muted"> · {formatPoints(e.ratePercent)}%</span>}
                          {(e.reason || e.createdByName) && (
                            <span className="block text-xs text-muted">{[e.reason, e.createdByName].filter(Boolean).join(" · ")}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right font-medium tabular-nums ${e.points > 0 ? "text-emerald-700" : "text-red-700"}`}>
                          {e.points > 0 ? "+" : "−"}
                          {formatPoints(Math.abs(e.points))}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted">{e.expiresAt ? formatDate(e.expiresAt) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">Движений баллов нет</p>
            )}
            {canAdmin && editable && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_auto]">
                <input
                  inputMode="decimal"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                  placeholder="+100 или −50"
                  className={inputClass}
                />
                <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Причина корректировки" className={inputClass} />
                <button
                  type="button"
                  disabled={busy || !adjustPoints.trim() || adjustReason.trim().length < 5}
                  onClick={submitAdjust}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
                >
                  Изменить баллы
                </button>
              </div>
            )}
          </section>

          <LoyaltyFamilySection
            memberId={member.id}
            family={member.family}
            editable={editable}
            canRemove={canManage}
            onChanged={() => {
              load();
              onChanged();
            }}
          />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">История согласий</h3>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-medium">Дата</th>
                    <th className="px-3 py-2 font-medium">Согласие</th>
                    <th className="px-3 py-2 font-medium">Решение</th>
                    <th className="px-3 py-2 font-medium">Источник</th>
                    <th className="px-3 py-2 font-medium">Кто записал</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {member.history.map((h) => (
                    <tr key={h.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(h.recordedAt)}</td>
                      <td className="px-3 py-2 text-foreground">
                        {h.channel
                          ? `${LOYALTY_CONSENT_PURPOSE_LABELS_RU.MARKETING} · ${LOYALTY_CONSENT_CHANNEL_LABELS_RU[h.channel]}`
                          : LOYALTY_CONSENT_PURPOSE_LABELS_RU[h.purpose]}
                        {h.note && <span className="block text-xs text-muted">{h.note}</span>}
                      </td>
                      <td className={`px-3 py-2 font-medium ${h.granted ? "text-emerald-700" : "text-red-700"}`}>{h.granted ? "Дано" : "Отозвано"}</td>
                      <td className="px-3 py-2 text-muted">{LOYALTY_CONSENT_SOURCE_LABELS_RU[h.source]}</td>
                      <td className="px-3 py-2 text-muted">{h.recordedByName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {member.mergedFrom.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Объединённые записи</h3>
              <ul className="space-y-1 text-sm">
                {member.mergedFrom.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setCurrentId(m.id)} className="text-left text-foreground hover:underline">
                      {formatKzPhone(m.phone)}
                      {m.name ? ` · ${m.name}` : ""}
                    </button>
                    <span className="text-muted">{m.mergedAt ? formatDate(m.mergedAt) : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canAdmin && editable && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Объединить с дублем</h3>
              <div className="flex flex-wrap gap-2">
                <input
                  type="tel"
                  value={mergePhone}
                  onChange={(e) => {
                    setMergePhone(e.target.value);
                    setMergeCandidate(null);
                  }}
                  placeholder="Телефон дубля"
                  className={`${inputClass} max-w-xs`}
                />
                <button type="button" onClick={findMergeCandidate} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted">
                  Найти
                </button>
              </div>
              {mergeCandidate && (
                <div className="mt-3 rounded-xl border border-border bg-surface-muted p-4">
                  <p className="mb-1 text-sm text-foreground">
                    {formatKzPhone(mergeCandidate.phone)}
                    {mergeCandidate.name ? ` · ${mergeCandidate.name}` : ""} <MemberStatusBadge status={mergeCandidate.status} />
                  </p>
                  <p className="mb-3 text-sm text-red-700">
                    Эта запись станет частью текущей. Отменить нельзя; её баллы перейдут сюда, согласия на рассылки не переносятся.
                  </p>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Причина</label>
                  <input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} className={`${inputClass} mb-3`} />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={busy || mergeReason.trim().length < 5}
                      onClick={submitMerge}
                      className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
                    >
                      Объединить
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
