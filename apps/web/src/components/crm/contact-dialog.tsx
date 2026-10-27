"use client";

import { useState } from "react";
import { Copy, MessageCircle, Phone } from "lucide-react";
import {
  CRM_CONTACT_CHANNEL_LABELS_RU,
  CRM_CONTACT_OUTCOME_LABELS_RU,
  CrmChannelsDto,
  CrmContactChannel,
  CrmContactOutcome,
  CrmContactReason,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Avatar, CrmModal, fmtPhone, telLink, whatsappLink } from "./ui";

export interface ContactTarget {
  memberId: string | null;
  customerId: string | null;
  name: string | null;
  phone: string | null;
  reason: CrmContactReason;
  suggestedText: string;
  channels: CrmChannelsDto;
}

const OUTCOMES = [CrmContactOutcome.SENT, CrmContactOutcome.TALKED, CrmContactOutcome.NO_ANSWER, CrmContactOutcome.DECLINED, CrmContactOutcome.ORDERED];
const CHANNELS = [CrmContactChannel.WHATSAPP, CrmContactChannel.CALL, CrmContactChannel.IN_PERSON, CrmContactChannel.TELEGRAM, CrmContactChannel.SMS];

export function ContactDialog({ target, onClose, onSaved }: { target: ContactTarget; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(target.suggestedText);
  const [channel, setChannel] = useState<CrmContactChannel>(target.channels.whatsapp ? CrmContactChannel.WHATSAPP : CrmContactChannel.CALL);
  const [outcome, setOutcome] = useState<CrmContactOutcome>(CrmContactOutcome.SENT);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Не удалось скопировать — выделите текст вручную");
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.crm.recordContact({
        memberId: target.memberId ?? undefined,
        customerId: target.customerId ?? undefined,
        channel,
        outcome,
        reason: target.reason,
        note: note.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  };

  return (
    <CrmModal
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <Avatar name={target.name} size={26} />
          <span>{target.name ?? fmtPhone(target.phone)}</span>
          {target.name && target.phone && <span className="muted num" style={{ fontWeight: 400, fontSize: 14 }}>{fmtPhone(target.phone)}</span>}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="crm-btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="crm-btn primary" onClick={save} disabled={saving}>
            {saving ? "Сохраняю…" : "Отметить"}
          </button>
        </>
      }
    >
      <label className="crm-label">
        Сообщение
        <textarea className="crm-textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {target.phone && target.channels.whatsapp && (
          <a className="crm-btn" href={whatsappLink(target.phone, text)} target="_blank" rel="noreferrer" onClick={() => setChannel(CrmContactChannel.WHATSAPP)} style={{ color: "var(--green)" }}>
            <MessageCircle size={15} /> Открыть WhatsApp
          </a>
        )}
        {target.phone && target.channels.call && (
          <a className="crm-btn" href={telLink(target.phone)} onClick={() => setChannel(CrmContactChannel.CALL)}>
            <Phone size={15} /> Позвонить
          </a>
        )}
        <button type="button" className="crm-btn ghost" onClick={copy}>
          <Copy size={15} /> {copied ? "Скопировано" : "Скопировать текст"}
        </button>
      </div>
      {!target.channels.whatsapp && target.memberId && <span className="muted" style={{ fontSize: 13.5 }}>Нет согласия на сообщения в WhatsApp</span>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="crm-label">Как связались</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CHANNELS.map((c) => (
            <button key={c} type="button" className={`crm-choice${channel === c ? " on" : ""}`} onClick={() => setChannel(c)}>
              {CRM_CONTACT_CHANNEL_LABELS_RU[c]}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="crm-label">Итог</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OUTCOMES.map((o) => (
            <button key={o} type="button" className={`crm-choice${outcome === o ? " on" : ""}`} onClick={() => setOutcome(o)}>
              {CRM_CONTACT_OUTCOME_LABELS_RU[o]}
            </button>
          ))}
        </div>
      </div>
      <label className="crm-label">
        Заметка
        <input className="crm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: придёт в субботу за тортом" />
      </label>
      {error && <div className="crm-error">{error}</div>}
    </CrmModal>
  );
}
