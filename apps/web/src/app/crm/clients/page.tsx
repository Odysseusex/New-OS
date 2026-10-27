"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Users } from "lucide-react";
import { CrmMemberListDto, LOYALTY_SEGMENT_LABELS_RU, LOYALTY_SEGMENTS, LoyaltySegment } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { agoDays, Avatar, ErrorBox, everyDays, fmtMoney, fmtPhone, PageHeader, SegmentTag, SEGMENT_TONES, Skeleton } from "@/components/crm/ui";

const SORTS = [
  { key: "recent", label: "Недавние" },
  { key: "spend", label: "По сумме" },
  { key: "visits", label: "По визитам" },
  { key: "new", label: "Новые" },
];

export default function CrmClientsPage() {
  return (
    <Suspense>
      <ClientsList />
    </Suspense>
  );
}

function ClientsList() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<LoyaltySegment | "">((params.get("segment") as LoyaltySegment) ?? "");
  const [sort, setSort] = useState("recent");
  const [data, setData] = useState<CrmMemberListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The base is searched on the server (it is people's phone numbers); a short
  // pause after typing keeps it to one request per word.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.crm
      .members({ q: query || undefined, segment: segment || undefined, sort })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Не удалось загрузить"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, segment, sort]);

  const subtitle = useMemo(() => (data ? `${data.total} в базе` : undefined), [data]);

  return (
    <div className="crm-wrap">
      <PageHeader icon={<Users size={30} strokeWidth={1.6} />} tone="blue" title="Клиенты" subtitle={subtitle} />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label className="crm-search" style={{ flex: "1 1 280px", maxWidth: 420 }}>
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или телефон" aria-label="Поиск клиента" />
        </label>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SORTS.map((s) => (
            <button key={s.key} type="button" className={`crm-tab${sort === s.key ? " on" : ""}`} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className={`crm-choice${segment === "" ? " on" : ""}`} onClick={() => setSegment("")}>
          Все
        </button>
        {LOYALTY_SEGMENTS.map((s) => (
          <button key={s} type="button" className={`crm-choice${segment === s ? " on" : ""}`} onClick={() => setSegment(s)}>
            <span className="crm-dot" style={{ background: `var(--${SEGMENT_TONES[s]})` }} />
            {LOYALTY_SEGMENT_LABELS_RU[s]}
          </button>
        ))}
      </div>
      {data && !data.segmentsAvailable && segment && <span className="muted">Группы считаются, когда покупки есть хотя бы у 30 клиентов</span>}

      {error && <ErrorBox message={error} />}

      <section className="crm-panel" style={{ overflow: "hidden" }} aria-label="Список клиентов">
        <div className="crm-row" style={{ borderTop: 0, color: "var(--tx3)", fontSize: 12.5, fontWeight: 500 }}>
          <span style={{ flex: "2 1 220px" }}>Клиент</span>
          <span style={{ flex: "1 1 130px" }}>Группа</span>
          <span className="hide-sm" style={{ width: 70, textAlign: "right" }}>Визиты</span>
          <span style={{ width: 100, textAlign: "right" }}>Сумма</span>
          <span className="hide-sm" style={{ width: 120 }}>Был</span>
          <span className="hide-sm" style={{ width: 120 }}>Ритм</span>
        </div>
        {loading && !data && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} style={{ margin: "6px 12px" }} />)}
        {data && data.items.length === 0 && <div className="crm-row muted">Никого не нашли</div>}
        {data?.items.map((m) => (
          <div key={m.id} className="crm-row clickable" onClick={() => router.push(`/crm/clients/${m.id}`)} style={{ opacity: loading ? 0.6 : 1 }}>
            <span style={{ flex: "2 1 220px", display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <Avatar name={m.name} size={26} />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name ?? "Без имени"}</span>
                <span className="muted num" style={{ fontSize: 12.5 }}>{fmtPhone(m.phone)}</span>
              </span>
            </span>
            <span style={{ flex: "1 1 130px" }}>
              <SegmentTag segment={m.segment} />
            </span>
            <span className="num hide-sm" style={{ width: 70, textAlign: "right" }}>{m.visits}</span>
            <span className="num" style={{ width: 100, textAlign: "right", fontWeight: 500 }}>{fmtMoney(m.spend)}</span>
            <span className="tx2 hide-sm" style={{ width: 120, fontSize: 13.5 }}>{m.lastVisitAt ? agoDays(m.daysSinceLastVisit) : "—"}</span>
            <span className="hide-sm" style={{ width: 120, fontSize: 13.5, color: m.overdueDays && m.overdueDays > 0 ? "var(--red)" : "var(--tx2)" }}>
              {everyDays(m.rhythmDays) ?? "—"}
            </span>
          </div>
        ))}
      </section>
      {data && data.total > data.items.length && <span className="muted">Показаны первые {data.items.length} из {data.total} — уточните поиск</span>}
      <style>{`@media (max-width: 700px) { .crm .hide-sm { display: none; } }`}</style>
    </div>
  );
}
