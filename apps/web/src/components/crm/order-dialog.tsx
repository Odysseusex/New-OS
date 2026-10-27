"use client";

import { useState } from "react";
import { CRM_ORDER_STAGE_LABELS_RU, CRM_ORDER_STAGES, CrmOrderDto, CrmOrderStage, SaveCrmOrderRequestDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { CrmModal, fmtWhen } from "./ui";

// "YYYY-MM-DDTHH:mm" in the browser's own clock, for <input type="datetime-local">.
function localValue(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 2 * 86_400_000);
  if (!iso) d.setHours(17, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const toNumber = (v: string) => {
  const n = Number(v.replace(",", ".").replace(/\s/g, ""));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
};

export function OrderDialog({
  order,
  preset,
  onClose,
  onSaved,
}: {
  order: CrmOrderDto | null;
  preset?: { memberId: string; customerName: string; phone: string | null };
  onClose: () => void;
  onSaved: (o: CrmOrderDto) => void;
}) {
  const [customerName, setCustomerName] = useState(order?.customerName ?? preset?.customerName ?? "");
  const [phone, setPhone] = useState(order?.phone ?? preset?.phone ?? "");
  const [title, setTitle] = useState(order?.title ?? "");
  const [details, setDetails] = useState(order?.details ?? "");
  const [weight, setWeight] = useState(order?.weightKg ? String(order.weightKg).replace(".", ",") : "");
  const [price, setPrice] = useState(order?.price ? String(order.price) : "");
  const [dueAt, setDueAt] = useState(localValue(order?.dueAt ?? null));
  const [stage, setStage] = useState<CrmOrderStage>(order?.stage ?? CrmOrderStage.NEW);
  const [cancelReason, setCancelReason] = useState(order?.cancelReason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const dto: SaveCrmOrderRequestDto = {
      customerName,
      phone: phone.trim() || null,
      title,
      details: details.trim() || null,
      weightKg: toNumber(weight),
      price: toNumber(price),
      dueAt: new Date(dueAt).toISOString(),
      stage,
      ...(stage === CrmOrderStage.CANCELLED ? { cancelReason: cancelReason.trim() || null } : {}),
      ...(preset && !order ? { memberId: preset.memberId } : {}),
    };
    try {
      onSaved(order ? await api.crm.updateOrder(order.id, dto) : await api.crm.createOrder(dto));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  };

  return (
    <CrmModal
      title={order ? `Заказ №${order.number}` : "Новый заказ"}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button type="button" className="crm-btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="crm-btn primary" onClick={save} disabled={saving}>
            {saving ? "Сохраняю…" : order ? "Сохранить" : "Создать заказ"}
          </button>
        </>
      }
    >
      <label className="crm-label">
        Что заказали
        <input className="crm-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Торт «Шоколадный», 2 кг" autoFocus />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <label className="crm-label">
          Заказчик
          <input className="crm-input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </label>
        <label className="crm-label">
          Телефон
          <input className="crm-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+7 7__ ___ __ __" />
        </label>
        <label className="crm-label">
          Выдача
          <input className="crm-input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label className="crm-label">
          Вес, кг
          <input className="crm-input" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" />
        </label>
        <label className="crm-label">
          Цена, ₸
          <input className="crm-input" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      <label className="crm-label">
        Пожелания
        <textarea className="crm-textarea" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Надпись, начинка, оформление" />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="crm-label">Этап</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[...CRM_ORDER_STAGES, CrmOrderStage.CANCELLED].map((s) => (
            <button key={s} type="button" className={`crm-choice${stage === s ? " on" : ""}`} onClick={() => setStage(s)}>
              {CRM_ORDER_STAGE_LABELS_RU[s]}
            </button>
          ))}
        </div>
      </div>
      {stage === CrmOrderStage.CANCELLED && (
        <label className="crm-label">
          Причина отмены
          <input className="crm-input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </label>
      )}
      {stage === CrmOrderStage.PREPAID && <span className="muted" style={{ fontSize: 13.5 }}>Предоплата принимается на кассе обычной продажей</span>}
      {order && order.events.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {order.events
            .slice()
            .reverse()
            .map((e, i) => (
              <span key={i} className="muted" style={{ fontSize: 13 }}>
                {CRM_ORDER_STAGE_LABELS_RU[e.toStage]} · {e.byName ?? ""} · {fmtWhen(e.at)}
              </span>
            ))}
        </div>
      )}
      {error && <div className="crm-error">{error}</div>}
    </CrmModal>
  );
}
