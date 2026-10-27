"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Cake, Check, Sunrise } from "lucide-react";
import { CRM_CONTACT_OUTCOME_LABELS_RU, CRM_ORDER_STAGE_LABELS_RU, CrmTodayCardDto, CrmTodayDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useCrm } from "@/components/crm/shell";
import { ContactDialog } from "@/components/crm/contact-dialog";
import { Avatar, daysWord, ErrorBox, everyDays, fmtDayKey, fmtMoney, fmtToday, fmtWhen, PageHeader, Skeleton, Tag, Tone } from "@/components/crm/ui";

const COLUMNS: { key: keyof Pick<CrmTodayDto, "due" | "lapsed" | "wholesale" | "birthdays">; name: string; tone: Tone; empty: string }[] = [
  { key: "due", name: "Пора за покупкой", tone: "green", empty: "Все пришли вовремя" },
  { key: "lapsed", name: "Давно не были", tone: "orange", empty: "Никто не пропал" },
  { key: "wholesale", name: "Опт · дозаказ", tone: "blue", empty: "Дозаказы по графику" },
  { key: "birthdays", name: "Дни рождения", tone: "purple", empty: "На этой неделе нет" },
];

export default function CrmTodayPage() {
  const { refreshCounts } = useCrm();
  const [data, setData] = useState<CrmTodayDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<CrmTodayCardDto | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.crm
      .today()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить"));
  }, []);
  useEffect(() => load(), [load]);

  return (
    <div className="crm-wrap">
      <PageHeader icon={<Sunrise size={30} strokeWidth={1.6} />} tone="orange" title="Сегодня" subtitle={fmtToday()} />

      {error && <ErrorBox message={error} onRetry={load} />}

      <section className="crm-metrics" aria-label="Показатели">
        {[
          { label: "Написать сегодня", value: data ? String(data.stats.toContact) : null },
          { label: "Уже написали", value: data ? String(data.stats.contactedToday) : null },
          { label: "Вернулись после сообщения, 30 дн.", value: data ? `${data.stats.returned30} из ${data.stats.contacts30}` : null },
          { label: "Выручка от вернувшихся, 30 дн.", value: data ? fmtMoney(data.stats.returnedRevenue30) : null },
        ].map((m) => (
          <div key={m.label} className="crm-metric">
            <span className="tx2" style={{ fontWeight: 500, fontSize: 13.5 }}>
              {m.label}
            </span>
            {m.value === null ? <Skeleton height={28} style={{ width: 80 }} /> : <span className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>{m.value}</span>}
          </div>
        ))}
      </section>

      {data && data.agenda.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-label="Ближайшие заказы">
          <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
            Ближайшие заказы
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.agenda.map((a) => (
              <Link key={a.orderId} href="/crm/orders" className="crm-card clickable" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "8px 12px" }}>
                <span style={{ color: "var(--pink)", display: "inline-flex" }}>
                  <Cake size={15} />
                </span>
                <span style={{ fontWeight: 500 }}>{a.title}</span>
                <span className="muted">· {a.customerName}</span>
                <Tag tone="pink" dot={false} style={{ height: 22, fontSize: 12.5 }}>
                  {fmtWhen(a.dueAt)}
                </Tag>
                <span className="muted" style={{ fontSize: 12.5 }}>{CRM_ORDER_STAGE_LABELS_RU[a.stage]}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="crm-tabs" style={{ paddingBottom: 0, borderBottom: 0 }}>
        <span className="crm-tab on">Кому написать</span>
      </div>

      <section className="crm-board" aria-label="Кому написать сегодня">
        {COLUMNS.map((col) => {
          const cards = data?.[col.key] ?? [];
          return (
            <div key={col.key} className="crm-col" style={{ background: `color-mix(in srgb, var(--${col.tone}-bg) var(--col), transparent)` }}>
              <div className="crm-colhead">
                <Tag tone={col.tone}>{col.name}</Tag>
                {data && <span className="num" style={{ color: `var(--${col.tone})`, fontWeight: 500, fontSize: 13.5 }}>{cards.length}</span>}
              </div>
              {!data && !error && [0, 1].map((i) => <Skeleton key={i} height={96} />)}
              {data && cards.length === 0 && <div className="crm-empty">{col.empty}</div>}
              {cards.map((card) => (
                <TodayCard key={card.key} card={card} onOpen={() => setActive(card)} />
              ))}
            </div>
          );
        })}
      </section>

      {data && data.done.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="h-done">
          <div className="crm-colhead" style={{ padding: 0 }}>
            <Tag tone="gray">
              <span id="h-done">Написали сегодня</span>
            </Tag>
            <span className="num muted" style={{ fontSize: 13.5 }}>{data.done.length}</span>
          </div>
          <div className="crm-board">
            {data.done.map((card) => (
              <TodayCard key={card.key} card={card} onOpen={() => setActive(card)} />
            ))}
          </div>
        </section>
      )}

      {active && (
        <ContactDialog
          target={active}
          onClose={() => setActive(null)}
          onSaved={() => {
            setActive(null);
            load();
            refreshCounts();
          }}
        />
      )}
    </div>
  );
}

function TodayCard({ card, onOpen }: { card: CrmTodayCardDto; onOpen: () => void }) {
  const done = !!card.contactedAt;
  const late = card.overdueDays !== null && card.overdueDays > 0;
  return (
    <article className="crm-card clickable" onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()} tabIndex={0} style={done ? { opacity: 0.85 } : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Avatar name={card.name} />
        {card.memberId ? (
          <Link href={`/crm/clients/${card.memberId}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500, flex: 1, minWidth: 0 }}>
            {card.name ?? card.phone}
          </Link>
        ) : (
          <span style={{ fontWeight: 500, flex: 1, minWidth: 0 }}>{card.name ?? card.phone}</span>
        )}
        {done && (
          <span style={{ color: "var(--green)", display: "inline-flex" }} title="Написали">
            <Check size={16} strokeWidth={2.4} />
          </span>
        )}
      </div>
      {card.birthday ? (
        <span className="tx2" style={{ fontSize: 13.5 }}>
          {card.birthday.name}
          {card.birthday.relation ? `, ${card.birthday.relation}` : ""}
          {card.birthday.turns ? ` · исполнится ${card.birthday.turns}` : ""}
        </span>
      ) : card.usual.length > 0 ? (
        <span className="tx2" style={{ fontSize: 13.5 }}>{card.usual.join(", ")}</span>
      ) : null}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {card.birthday && (
          <>
            <span className="crm-mini">{fmtDayKey(card.birthday.date)}</span>
            <span className="crm-mini" style={{ background: "var(--purple-bg)", color: "var(--purple)" }}>
              {card.birthday.inDays === 0 ? "сегодня" : `через ${card.birthday.inDays} ${daysWord(card.birthday.inDays)}`}
            </span>
          </>
        )}
        {!card.birthday && card.rhythmDays !== null && <span className="crm-mini">{everyDays(card.rhythmDays)}</span>}
        {!card.birthday && late && card.daysSinceLastVisit !== null && (
          <span className="crm-mini num" style={{ background: "var(--red-bg)", color: "var(--red)" }}>
            {card.stopped
              ? `${card.customerId ? "не заказывал" : "не был"} ${card.daysSinceLastVisit} ${daysWord(card.daysSinceLastVisit)}`
              : `+${card.overdueDays} ${daysWord(card.overdueDays!)}`}
          </span>
        )}
        {card.pointsBalance > 0 && <span className="crm-mini num">{Math.floor(card.pointsBalance)} б.</span>}
      </div>
      {done && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {CRM_CONTACT_OUTCOME_LABELS_RU[card.contactOutcome!]} · {card.contactedByName ?? ""} · {fmtWhen(card.contactedAt!)}
        </span>
      )}
    </article>
  );
}
