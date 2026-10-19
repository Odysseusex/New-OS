"use client";

import { useState } from "react";
import type { LoyaltyMemberDto } from "@bakery-os/shared";
import {
  KZ_PHONE_INVALID_MESSAGE,
  LOYALTY_CONSENT_CHANNEL_LABELS_RU,
  LOYALTY_CONSENT_CHANNELS,
  LoyaltyConsentChannel,
  LoyaltyConsentSource,
  normalizeKzPhone,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ConsentSourceSelect, inputClass } from "@/components/loyalty-shared";

export function LoyaltyRegisterModal({
  initialPhone = "",
  onClose,
  onSaved,
}: {
  initialPhone?: string;
  onClose: () => void;
  onSaved: (member: LoyaltyMemberDto) => void;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [name, setName] = useState("");
  const [personalData, setPersonalData] = useState(false);
  const [channels, setChannels] = useState<LoyaltyConsentChannel[]>([]);
  const [source, setSource] = useState<LoyaltyConsentSource>(LoyaltyConsentSource.AT_TILL);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleChannel(channel: LoyaltyConsentChannel) {
    setChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalizeKzPhone(phone)) {
      setError(KZ_PHONE_INVALID_MESSAGE);
      return;
    }
    setIsSubmitting(true);
    try {
      const member = await api.loyalty.register({
        phone,
        name: name || undefined,
        personalDataConsent: personalData,
        marketingChannels: personalData ? channels : [],
        source,
      });
      onSaved(member);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось зарегистрировать клиента");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Новый розничный клиент" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Телефон</label>
            <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 701 123 45 67" className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Имя</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
        </div>

        <label className="mb-3 flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={personalData}
            onChange={(e) => {
              setPersonalData(e.target.checked);
              // WhatsApp is the programme's main channel: offered by default, the cashier can untick it.
              if (e.target.checked && channels.length === 0) setChannels([LoyaltyConsentChannel.WHATSAPP]);
            }}
            className="mt-0.5"
          />
          <span>Клиент дал согласие на обработку персональных данных</span>
        </label>

        <div className="mb-4">
          <p className="mb-1.5 text-sm font-medium text-foreground">Согласие на рекламные рассылки</p>
          <div className="flex flex-wrap gap-4">
            {LOYALTY_CONSENT_CHANNELS.map((channel) => (
              <label key={channel} className={`flex items-center gap-2 text-sm ${personalData ? "text-foreground" : "text-muted"}`}>
                <input type="checkbox" disabled={!personalData} checked={personalData && channels.includes(channel)} onChange={() => toggleChannel(channel)} />
                {LOYALTY_CONSENT_CHANNEL_LABELS_RU[channel]}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Как получено согласие</label>
          <ConsentSourceSelect value={source} onChange={setSource} />
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted">
            Отмена
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !personalData}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? "Сохранение…" : "Зарегистрировать"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
