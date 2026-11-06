"use client";

import { useState } from "react";
import { Gift, Pencil, Trash2 } from "lucide-react";
import {
  isValidBirthDate,
  LoyaltyConsentChannel,
  LoyaltyConsentPurpose,
  LoyaltyConsentSource,
  LoyaltyMemberDetailDto,
  MONTHS_GENITIVE_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { CrmModal, fmtPhone } from "./ui";

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const CHANNELS: { channel: LoyaltyConsentChannel; label: string }[] = [
  { channel: LoyaltyConsentChannel.WHATSAPP, label: "WhatsApp" },
  { channel: LoyaltyConsentChannel.TELEGRAM, label: "Telegram" },
];

// Editing a retail customer from the CRM: name, note, marketing consents (each change is a new
// consent record, never an edit) and birthdays (added / removed at once). The phone is the
// customer's identity and is not edited — a new number is a new card merged in the ERP.
export function MemberEditDialog({ member, onClose, onSaved }: { member: LoyaltyMemberDetailDto; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(member.name ?? "");
  const [note, setNote] = useState(member.note ?? "");
  const [marketing, setMarketing] = useState<Record<LoyaltyConsentChannel, boolean>>({ ...member.consents.marketing });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [family, setFamily] = useState(member.family);
  const [fName, setFName] = useState("");
  const [fRelation, setFRelation] = useState("");
  const [fDay, setFDay] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fYear, setFYear] = useState("");
  const [familyBusy, setFamilyBusy] = useState(false);
  // The birthday row being corrected in the form below (null = adding a new one).
  const [editingId, setEditingId] = useState<string | null>(null);
  const yearNum = fYear.trim() ? Number(fYear) : null;
  const dateOk = fDay !== "" && fMonth !== "" && isValidBirthDate(Number(fMonth), Number(fDay), yearNum);
  const canMarket = member.consents.personalData;

  const reloadFamily = async () => setFamily((await api.loyalty.findOne(member.id)).family);

  const addBirthday = async () => {
    setFamilyBusy(true);
    setError(null);
    try {
      const dto = {
        name: fName.trim(),
        relation: fRelation.trim() || undefined,
        birthDay: Number(fDay),
        birthMonth: Number(fMonth),
        birthYear: yearNum,
      };
      if (editingId) await api.loyalty.updateFamily(editingId, dto);
      else await api.loyalty.addFamily(member.id, dto);
      setEditingId(null);
      setFName("");
      setFRelation("");
      setFDay("");
      setFMonth("");
      setFYear("");
      await reloadFamily();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось добавить");
    } finally {
      setFamilyBusy(false);
    }
  };

  const removeBirthday = async (id: string) => {
    setFamilyBusy(true);
    setError(null);
    try {
      await api.loyalty.removeFamily(id);
      await reloadFamily();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить");
    } finally {
      setFamilyBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if ((name.trim() || null) !== (member.name ?? null) || (note.trim() || null) !== (member.note ?? null)) {
        await api.loyalty.update(member.id, { name: name.trim() || null, note: note.trim() || null });
        // A birthday registered at the till before the name was known is named «Клиент»: it follows.
        const own = family.filter((f) => f.relation === "Сам клиент" && (f.name === "Клиент" || f.name === member.name));
        if (name.trim()) {
          for (const f of own) {
            await api.loyalty.updateFamily(f.id, { name: name.trim(), relation: f.relation ?? undefined, birthDay: f.birthDay, birthMonth: f.birthMonth, birthYear: f.birthYear });
          }
        }
      }
      for (const { channel } of CHANNELS) {
        if (marketing[channel] !== member.consents.marketing[channel]) {
          await api.loyalty.recordConsent(member.id, {
            purpose: LoyaltyConsentPurpose.MARKETING,
            channel,
            granted: marketing[channel],
            source: LoyaltyConsentSource.OTHER,
            note: "Изменено в CRM",
          });
        }
      }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  };

  return (
    <CrmModal
      title={`Изменить · ${fmtPhone(member.phone)}`}
      onClose={() => (family !== member.family ? onSaved() : onClose())}
      footer={
        <>
          <button type="button" className="crm-btn ghost" onClick={() => (family !== member.family ? onSaved() : onClose())}>
            Отмена
          </button>
          <button type="button" className="crm-btn primary" onClick={save} disabled={saving}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </>
      }
    >
      <label className="crm-label">
        Имя
        <input className="crm-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </label>
      <label className="crm-label">
        Заметка
        <input className="crm-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Любит без сахара, приходит по субботам…" />
      </label>

      <div className="crm-label">
        Рассылки
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", color: "var(--tx)", fontWeight: 400 }}>
          {CHANNELS.map(({ channel, label }) => (
            <label key={channel} style={{ display: "inline-flex", alignItems: "center", gap: 8, opacity: canMarket ? 1 : 0.5 }}>
              <input
                type="checkbox"
                disabled={!canMarket}
                checked={canMarket && marketing[channel]}
                onChange={(e) => setMarketing((m) => ({ ...m, [channel]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        {!canMarket && <span className="muted" style={{ fontWeight: 400 }}>Нет согласия на обработку персональных данных</span>}
      </div>

      <div className="crm-label">
        Дни рождения
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 400, color: "var(--tx)" }}>
          {family.length === 0 && <span className="muted">Не указаны</span>}
          {family.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30 }}>
              <Gift size={14} style={{ color: "var(--purple)" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {f.name}
                {f.relation ? <span className="muted">, {f.relation}</span> : null} ·{" "}
                <span className="num">
                  {f.birthDay} {MONTHS_GENITIVE_RU[f.birthMonth - 1]}
                  {f.birthYear ? ` ${f.birthYear}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="crm-btn ghost sm"
                disabled={familyBusy}
                aria-label="Изменить"
                onClick={() => {
                  setEditingId(f.id);
                  setFName(f.name);
                  setFRelation(f.relation ?? "");
                  setFDay(String(f.birthDay));
                  setFMonth(String(f.birthMonth));
                  setFYear(f.birthYear ? String(f.birthYear) : "");
                }}
              >
                <Pencil size={14} />
              </button>
              <button type="button" className="crm-btn ghost sm" disabled={familyBusy} onClick={() => removeBirthday(f.id)} aria-label="Удалить">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="crm-panel" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontWeight: 400 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input className="crm-input" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Имя" maxLength={100} />
            <input className="crm-input" value={fRelation} onChange={(e) => setFRelation(e.target.value)} placeholder="Кто это: сам клиент, сын…" maxLength={50} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px auto", gap: 10 }}>
            <select className="crm-select" value={fDay} onChange={(e) => setFDay(e.target.value)} aria-label="День">
              <option value="">День</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select className="crm-select" value={fMonth} onChange={(e) => setFMonth(e.target.value)} aria-label="Месяц">
              <option value="">Месяц</option>
              {MONTHS_GENITIVE_RU.map((m, i) => (
                <option key={m} value={i + 1}>
                  {String(i + 1).padStart(2, "0")} — {m}
                </option>
              ))}
            </select>
            <input className="crm-input num" inputMode="numeric" value={fYear} onChange={(e) => setFYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Год" />
            <button type="button" className="crm-btn" disabled={familyBusy || !fName.trim() || !dateOk} onClick={addBirthday}>
              {editingId ? "Сохранить" : "Добавить"}
            </button>
          </div>
          {fDay !== "" && fMonth !== "" && !dateOk && <span style={{ color: "var(--red)" }}>Такой даты нет</span>}
          {editingId && (
            <button
              type="button"
              className="crm-btn ghost sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                setEditingId(null);
                setFName("");
                setFRelation("");
                setFDay("");
                setFMonth("");
                setFYear("");
              }}
            >
              Отменить исправление
            </button>
          )}
        </div>
      </div>

      {error && <div style={{ color: "var(--red)" }}>{error}</div>}
    </CrmModal>
  );
}
