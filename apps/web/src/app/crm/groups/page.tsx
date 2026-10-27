"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { DEFAULT_LOYALTY_CHURN_SETTINGS, LOYALTY_SEGMENT_LABELS_RU, LOYALTY_SEGMENTS, LoyaltyAnalyticsDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { agoDays, Avatar, ErrorBox, fmtMoney, fmtPhone, PageHeader, plural, SEGMENT_TONES, Skeleton, Tag } from "@/components/crm/ui";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export default function CrmGroupsPage() {
  const [data, setData] = useState<LoyaltyAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - 30 * 86_400_000).toISOString(), to: to.toISOString() };
  }, []);

  const load = useCallback(() => {
    setError(null);
    api.loyalty
      .analytics(range.from, range.to, DEFAULT_LOYALTY_CHURN_SETTINGS)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить"));
  }, [range]);
  useEffect(() => load(), [load]);

  const totalScored = data?.segments.membersScored ?? 0;

  return (
    <div className="crm-wrap">
      <PageHeader icon={<Layers size={30} strokeWidth={1.6} />} tone="purple" title="Группы" subtitle={data?.segments.available ? `${totalScored} ${plural(totalScored, "клиент", "клиента", "клиентов")} с покупками за год` : undefined} />
      {error && <ErrorBox message={error} onRetry={load} />}

      <section className="crm-metrics" aria-label="Показатели за 30 дней">
        {[
          { label: "Активные клиенты, 30 дн.", value: data ? String(data.summary.activeMembers) : null },
          { label: "Новые, 30 дн.", value: data ? String(data.summary.newMembers) : null },
          { label: "Доля вернувшихся", value: data ? pct(data.summary.returningShare) : null },
          { label: "Доля выручки участников", value: data ? pct(data.summary.memberRevenueShare) : null },
        ].map((m) => (
          <div key={m.label} className="crm-metric">
            <span className="tx2" style={{ fontWeight: 500, fontSize: 13.5 }}>{m.label}</span>
            {m.value === null ? <Skeleton height={28} style={{ width: 70 }} /> : <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{m.value}</span>}
          </div>
        ))}
      </section>

      {data && !data.segments.available && (
        <div className="crm-panel" style={{ padding: 18 }}>
          Группы появятся, когда покупки будут хотя бы у {data.segments.minimumMembers} клиентов — сейчас {data.segments.membersScored}.
        </div>
      )}

      <section className="crm-board" aria-label="Группы клиентов">
        {(data ? LOYALTY_SEGMENTS : []).map((segment) => {
          const group = data!.segments.groups.find((g) => g.segment === segment)!;
          const tone = SEGMENT_TONES[segment];
          const people = data!.segments.rows.filter((r) => r.segment === segment).slice(0, 4);
          const share = totalScored ? group.members / totalScored : 0;
          return (
            <Link
              key={segment}
              href={`/crm/clients?segment=${segment}`}
              className="crm-col"
              style={{ background: `color-mix(in srgb, var(--${tone}-bg) var(--col), transparent)`, gap: 10, minHeight: 0 }}
            >
              <div className="crm-colhead">
                <Tag tone={tone}>{LOYALTY_SEGMENT_LABELS_RU[segment]}</Tag>
                <span className="num" style={{ color: `var(--${tone})`, fontWeight: 500, fontSize: 13.5 }}>{group.members}</span>
              </div>
              <div className="crm-card" style={{ gap: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{fmtMoney(group.revenue)}</span>
                  <span className="muted" style={{ fontSize: 13 }}>за год</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--gray-bg)" }}>
                  <div style={{ height: "100%", width: `${share * 100}%`, borderRadius: 3, background: `var(--${tone})` }} />
                </div>
                <span className="muted" style={{ fontSize: 13 }}>{pct(share)} клиентов</span>
                {people.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                    {people.map((p) => (
                      <span key={p.memberId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                        <Avatar name={p.name} size={20} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name ?? fmtPhone(p.phone)}</span>
                        <span className="muted num">{fmtMoney(p.spend)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
        {!data && !error && [0, 1, 2].map((i) => <Skeleton key={i} height={200} />)}
      </section>

      {data && (
        <section className="crm-panel" style={{ overflow: "hidden" }} aria-labelledby="h-radar">
          <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 id="h-radar" className="crm-h2">
              Ушедшие постоянные
            </h2>
            <Tag tone="red" dot={false} style={{ height: 22, fontSize: 12.5 }}>
              {String(data.churnRadar.rows.length)}
            </Tag>
            <span className="muted" style={{ fontSize: 13 }}>
              от {data.churnRadar.minVisits} покупок за {data.churnRadar.windowDays} дн., не были {data.churnRadar.inactiveDays}+ дн.
            </span>
          </div>
          {data.churnRadar.rows.length === 0 && <div className="crm-row muted">Таких нет</div>}
          {data.churnRadar.rows.slice(0, 30).map((r) => (
            <Link key={r.memberId} href={`/crm/clients/${r.memberId}`} className="crm-row clickable">
              <Avatar name={r.name} size={24} />
              <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{r.name ?? fmtPhone(r.phone)}</span>
              <span className="muted num" style={{ fontSize: 13.5 }}>
                {r.visits} {plural(r.visits, "покупка", "покупки", "покупок")}
              </span>
              <span className="num" style={{ width: 96, textAlign: "right" }}>{fmtMoney(r.spend)}</span>
              <span className="tx2" style={{ width: 120, textAlign: "right", fontSize: 13.5 }}>{agoDays(r.daysSinceLastVisit)}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
