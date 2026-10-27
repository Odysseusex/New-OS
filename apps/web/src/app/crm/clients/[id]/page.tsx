"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Cake, CircleDot, Gift, MessageCircle, MessageSquare, Phone, ShieldCheck, ShoppingBag, Sparkles, Undo2, UserPlus } from "lucide-react";
import {
  CRM_ORDER_STAGE_LABELS_RU,
  CrmContactReason,
  CrmMemberProfileDto,
  CrmOrderStage,
  CrmTimelineKind,
  LoyaltyMemberStatus,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useCrm } from "@/components/crm/shell";
import { ContactDialog } from "@/components/crm/contact-dialog";
import { OrderDialog } from "@/components/crm/order-dialog";
import { Avatar, daysWord, ErrorBox, everyDays, fmtDayKey, fmtDayMonth, fmtMoney, fmtPhone, fmtWhen, plural, SegmentTag, Skeleton, Tag, telLink, Tone } from "@/components/crm/ui";

const KIND: Record<CrmTimelineKind, { icon: React.ElementType; tone: Tone | "tx3" }> = {
  SALE: { icon: ShoppingBag, tone: "tx3" },
  RETURN: { icon: Undo2, tone: "orange" },
  POINTS: { icon: Sparkles, tone: "yellow" },
  MESSAGE: { icon: MessageSquare, tone: "blue" },
  CONTACT: { icon: MessageCircle, tone: "green" },
  CONSENT: { icon: ShieldCheck, tone: "purple" },
  ORDER: { icon: Cake, tone: "pink" },
  REGISTERED: { icon: UserPlus, tone: "tx3" },
};

export default function CrmClientPage() {
  const { id } = useParams<{ id: string }>();
  const { refreshCounts } = useCrm();
  const [data, setData] = useState<CrmMemberProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.crm
      .profile(id)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить"));
  }, [id]);
  useEffect(() => load(), [load]);

  if (error) {
    return (
      <div className="crm-wrap">
        <ErrorBox message={error} onRetry={load} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="crm-wrap">
        <Skeleton height={40} style={{ width: 320 }} />
        <Skeleton height={120} />
        <Skeleton height={320} />
      </div>
    );
  }

  const { member, stats, rhythm, favorites } = data;
  const name = member.name ?? fmtPhone(member.phone);
  const first = (member.name ?? "").trim().split(/\s+/)[0];
  const overdue = rhythm.overdueDays !== null && rhythm.overdueDays > 0;
  // The usual gap sits at about half height, so a late one visibly stands out.
  const maxGap = Math.max(1, ...rhythm.intervals, (rhythm.days ?? 0) * 2, stats.daysSinceLastVisit ?? 0);
  const activeOrders = data.orders.filter((o) => o.stage !== CrmOrderStage.DONE && o.stage !== CrmOrderStage.CANCELLED);

  const sentence = [
    favorites.length ? `Берёт ${favorites.slice(0, 2).map((f) => f.name.toLowerCase()).join(" и ")}${rhythm.days ? ` ${everyDays(rhythm.days)}` : ""}.` : null,
    stats.lastVisitAt ? `Последняя покупка — ${fmtDayMonth(stats.lastVisitAt)}${rhythm.expectedAt ? `, ${overdue ? "ожидали" : "ждём"} ${fmtDayMonth(rhythm.expectedAt)}` : ""}.` : "Покупок пока нет.",
    member.family.length ? `Дни рождения в семье: ${member.family.map((f) => f.name).join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <Link href="/crm/clients" className="muted" style={{ fontWeight: 500 }}>
          Клиенты
        </Link>
        <span className="muted">›</span>
        <span style={{ fontWeight: 500 }}>{name}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="crm-btn" onClick={() => setOrdering(true)}>
          <Cake size={15} /> Заказ торта
        </button>
        {data.channels.call && (
          <a className="crm-btn" href={telLink(member.phone)}>
            <Phone size={15} /> Позвонить
          </a>
        )}
        <button type="button" className="crm-btn primary" onClick={() => setWriting(true)} disabled={member.status !== LoyaltyMemberStatus.ACTIVE}>
          <MessageCircle size={15} /> Написать
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, padding: "0 20px 40px" }}>
        <div style={{ flex: "999 1 460px", minWidth: 0, padding: "36px 0 0", maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 30 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={member.name} size={48} />
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{name}</h1>
            </div>
            <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.6, color: "var(--tx2)" }}>{sentence}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <SegmentTag segment={data.segment} />
              {overdue && <Tag tone="red">{`Просрочено на ${rhythm.overdueDays} ${daysWord(rhythm.overdueDays!)}`}</Tag>}
              <Tag tone="gray" dot={false}>{`${Math.floor(member.pointsBalance)} ${plural(Math.floor(member.pointsBalance), "балл", "балла", "баллов")}`}</Tag>
              <Tag tone="gray" dot={false}>{`${stats.visits} ${plural(stats.visits, "визит", "визита", "визитов")} · ${fmtMoney(stats.spend)}`}</Tag>
              {member.status !== LoyaltyMemberStatus.ACTIVE && <Tag tone="red">{member.status === LoyaltyMemberStatus.MERGED ? "Объединён" : "Отозвал согласие"}</Tag>}
            </div>
          </section>

          {rhythm.intervals.length > 0 && (
            <section className="crm-panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }} aria-labelledby="h-rhythm">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h2 id="h-rhythm" className="crm-h2" style={{ fontSize: 14.5 }}>
                  Ритм покупок
                </h2>
                {rhythm.days && <span className="crm-mini">{everyDays(rhythm.days)}</span>}
                <span style={{ flex: 1 }} />
                {rhythm.expectedAt && <span className="muted" style={{ fontSize: 13.5 }}>следующая — {fmtDayMonth(rhythm.expectedAt)}</span>}
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 56 }} role="img" aria-label="Дни между покупками">
                {rhythm.intervals.map((g, i) => (
                  <span key={i} title={`${g} ${daysWord(g)}`} style={{ flex: 1, maxWidth: 28, height: `${Math.max(8, (g / maxGap) * 100)}%`, borderRadius: 3, background: g > (rhythm.days ?? g) * 2 ? "var(--orange)" : "var(--acc)", opacity: 0.85 }} />
                ))}
                {stats.daysSinceLastVisit !== null && (
                  <span title="Сейчас" style={{ flex: 1, maxWidth: 28, height: `${Math.min(100, Math.max(8, (stats.daysSinceLastVisit / maxGap) * 100))}%`, borderRadius: 3, background: overdue ? "var(--red)" : "var(--bar)", outline: "1px dashed var(--line2)" }} />
                )}
              </div>
            </section>
          )}

          {favorites.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tx2)" }}>Обычно покупает</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {favorites.map((f) => (
                  <span key={f.name} className="crm-tag" style={{ height: 30, padding: "0 12px", background: "var(--gray-bg)" }}>
                    {f.name}
                    <span className="muted num">{Math.round(f.share * 100)}%</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          <section style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-labelledby="h-act">
            <h2 id="h-act" className="crm-h2" style={{ fontSize: 17 }}>
              Активность
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {data.timeline.map((t) => {
                const k = KIND[t.kind];
                const Icon = k.icon;
                const rich = t.kind === "CONTACT" || t.kind === "MESSAGE";
                return rich && t.detail ? (
                  <div key={t.id} className="crm-ev">
                    <span className="crm-ev-ic" style={{ color: k.tone === "tx3" ? "var(--tx3)" : `var(--${k.tone})` }}>
                      <Icon size={15} />
                    </span>
                    <div className="crm-panel" style={{ flex: 1, minWidth: 0, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 13.5 }}>
                        <b>{t.title}</b>
                        {t.byName ? ` · ${t.byName}` : ""} · <span className="num">{fmtWhen(t.at)}</span>
                      </span>
                      <span style={{ color: "var(--tx)", whiteSpace: "pre-line" }}>{t.detail}</span>
                    </div>
                  </div>
                ) : (
                  <div key={t.id} className="crm-ev">
                    <span className="crm-ev-ic" style={{ color: k.tone === "tx3" ? "var(--tx3)" : `var(--${k.tone})` }}>
                      <Icon size={15} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <b>{t.title}</b>
                      {t.amount !== null ? ` · ${fmtMoney(t.amount)}` : ""}
                      {t.detail ? ` — ${t.detail}` : ""}
                      {t.byName ? ` · ${t.byName}` : ""} · <span className="num">{fmtWhen(t.at)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside style={{ flex: "1 1 300px", minWidth: 0, paddingTop: 36, display: "flex", flexDirection: "column", gap: 24, maxWidth: 420 }} aria-label="Свойства клиента">
          <PropGroup title="Свойства">
            <Prop k="Телефон" v={fmtPhone(member.phone)} />
            <Prop k="В программе с" v={fmtDayMonth(member.createdAt)} />
            <Prop k="Первая покупка" v={stats.firstVisitAt ? fmtDayMonth(stats.firstVisitAt) : "—"} />
            <Prop k="Средний чек" v={stats.averageCheck !== null ? fmtMoney(stats.averageCheck) : "—"} />
            <Prop k="Баллы" v={String(Math.floor(member.pointsBalance))} />
            {member.note && <Prop k="Заметка" v={member.note} />}
          </PropGroup>
          <PropGroup title="Согласия">
            <Prop k="Персональные данные" v={member.consents.personalData ? "есть" : "нет"} tone={member.consents.personalData ? "green" : "gray"} />
            <Prop k="WhatsApp" v={member.consents.marketing.WHATSAPP ? "есть" : "нет"} tone={member.consents.marketing.WHATSAPP ? "green" : "gray"} />
            <Prop k="Telegram" v={member.consents.marketing.TELEGRAM ? "есть" : "нет"} tone={member.consents.marketing.TELEGRAM ? "green" : "gray"} />
          </PropGroup>
          {member.family.length > 0 && (
            <PropGroup title="Дни рождения">
              {member.family.map((f) => (
                <Prop key={f.id} k={`${f.name}${f.relation ? `, ${f.relation}` : ""}`} v={fmtDayKey(f.nextBirthday)} tone="purple" icon={<Gift size={13} />} />
              ))}
            </PropGroup>
          )}
          <PropGroup title="Заказы">
            {data.orders.length === 0 && <span className="muted" style={{ fontSize: 13.5 }}>Заказов не было</span>}
            {data.orders.slice(0, 6).map((o) => (
              <Link key={o.id} href="/crm/orders" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30 }}>
                <span style={{ color: "var(--pink)", display: "inline-flex" }}>
                  <Cake size={14} />
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</span>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {activeOrders.includes(o) ? CRM_ORDER_STAGE_LABELS_RU[o.stage] : fmtDayMonth(o.dueAt)}
                </span>
              </Link>
            ))}
          </PropGroup>
        </aside>
      </div>

      {writing && (
        <ContactDialog
          target={{
            memberId: member.id,
            customerId: null,
            name: member.name,
            phone: member.phone,
            reason: overdue ? CrmContactReason.DUE : CrmContactReason.OTHER,
            suggestedText: first ? `${first}, добрый день! ` : "Добрый день! ",
            channels: data.channels,
          }}
          onClose={() => setWriting(false)}
          onSaved={() => {
            setWriting(false);
            load();
            refreshCounts();
          }}
        />
      )}
      {ordering && (
        <OrderDialog
          order={null}
          preset={{ memberId: member.id, customerName: member.name ?? fmtPhone(member.phone), phone: member.phone }}
          onClose={() => setOrdering(false)}
          onSaved={() => {
            setOrdering(false);
            load();
            refreshCounts();
          }}
        />
      )}
    </>
  );
}

function PropGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "var(--tx3)", fontWeight: 500, fontSize: 13, marginBottom: 4 }}>{title}</span>
      {children}
    </section>
  );
}

function Prop({ k, v, tone, icon }: { k: string; v: string; tone?: Tone; icon?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 30 }}>
      <span style={{ flex: "0 0 150px", color: "var(--tx3)" }}>{k}</span>
      <span className="num" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 500, minWidth: 0 }}>
        {tone && !icon && <CircleDot size={12} style={{ color: `var(--${tone})` }} />}
        {icon && <span style={{ color: `var(--${tone})`, display: "inline-flex" }}>{icon}</span>}
        {v}
      </span>
    </div>
  );
}
