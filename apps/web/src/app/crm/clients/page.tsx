"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gift, Search, Users } from "lucide-react";
import { CrmMemberListDto, LOYALTY_SEGMENT_LABELS_RU, LOYALTY_SEGMENTS, LoyaltySegment } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { agoDays, Avatar, CrmModal, ErrorBox, plural, everyDays, fmtMoney, fmtPhone, PageHeader, SegmentTag, SEGMENT_TONES, Skeleton } from "@/components/crm/ui";

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
  // Several clients at once: the ticked ones, or the whole base.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [everyone, setEveryone] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [reload, setReload] = useState(0);

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
  }, [query, segment, sort, reload]);

  const shownIds = data?.items.map((m) => m.id) ?? [];
  const allShown = shownIds.length > 0 && shownIds.every((id) => picked.has(id));
  const toggle = (id: string) => {
    setEveryone(false);
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleShown = () => {
    setEveryone(false);
    setPicked(allShown ? new Set() : new Set(shownIds));
  };
  const clearPicked = () => {
    setEveryone(false);
    setPicked(new Set());
  };
  const pickedCount = everyone ? (data?.total ?? 0) : picked.size;

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

      {pickedCount > 0 && (
        <div className="crm-panel crm-bulk">
          <span style={{ fontWeight: 600 }}>
            {everyone ? `Выбраны все в базе: ${pickedCount}` : `Выбрано: ${pickedCount}`}
          </span>
          {!everyone && data && !query && !segment && data.total > picked.size && (
            <button type="button" className="crm-btn ghost sm" onClick={() => setEveryone(true)}>
              Выбрать всех в базе ({data.total})
            </button>
          )}
          <button type="button" className="crm-btn ghost sm" onClick={clearPicked}>
            Снять выбор
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="crm-btn primary" onClick={() => setBonusOpen(true)}>
            <Gift size={15} /> Активировать бонус
          </button>
        </div>
      )}

      <section className="crm-panel" style={{ overflow: "hidden" }} aria-label="Список клиентов">
        <div className="crm-row" style={{ borderTop: 0, color: "var(--tx3)", fontSize: 12.5, fontWeight: 500 }}>
          <input type="checkbox" className="crm-check" checked={everyone || allShown} onChange={toggleShown} aria-label="Выбрать всех в списке" />
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
            <input
              type="checkbox"
              className="crm-check"
              checked={everyone || picked.has(m.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggle(m.id)}
              aria-label={`Выбрать: ${m.name ?? m.phone}`}
            />
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
      {bonusOpen && (
        <BulkBonusDialog
          ids={everyone ? null : Array.from(picked)}
          count={pickedCount}
          onClose={(done) => {
            setBonusOpen(false);
            if (done) {
              clearPicked();
              setReload((n) => n + 1);
            }
          }}
        />
      )}
      <style>{`@media (max-width: 700px) { .crm .hide-sm { display: none; } }
.crm-check { width: 17px; height: 17px; flex-shrink: 0; accent-color: var(--acc); cursor: pointer; }
.crm-bulk { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; position: sticky; top: 8px; z-index: 5; }`}</style>
    </div>
  );
}

const clientsDat = (n: number) => plural(n, "клиенту", "клиентам", "клиентам");
const clientsGen = (n: number) => plural(n, "клиента", "клиентов", "клиентов");
const num = new Intl.NumberFormat("ru-RU");

// The welcome bonus for the ticked clients (ids) or the whole base (ids = null),
// sent in portions of 50 so a long list never hangs on one request.
function BulkBonusDialog({ ids, count, onClose }: { ids: string[] | null; count: number; onClose: (done: boolean) => void }) {
  const [points, setPoints] = useState<number | null>(null);
  const [state, setState] = useState<"ask" | "run" | "done">("ask");
  const [progress, setProgress] = useState({ given: 0, skipped: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.loyalty
      .settings()
      .then((s) => setPoints(s.enabled ? s.welcomeBonusPoints : 0))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить настройки программы"));
  }, []);

  const run = async () => {
    setState("run");
    setError(null);
    let given = 0;
    let skipped = 0;
    const add = (r: { given: number; skipped: number }) => {
      given += r.given;
      skipped += r.skipped;
      setProgress({ given, skipped });
    };
    try {
      if (ids === null) {
        let afterId: string | undefined;
        for (;;) {
          const r = await api.loyalty.activateWelcomeBonusBulk({ all: true, afterId });
          add(r);
          if (!r.nextAfterId) break;
          afterId = r.nextAfterId;
        }
      } else {
        for (let i = 0; i < ids.length; i += 50) add(await api.loyalty.activateWelcomeBonusBulk({ memberIds: ids.slice(i, i + 50) }));
      }
    } catch (e) {
      // What was given stays given; pressing again only reaches the rest.
      setError(e instanceof ApiError ? e.message : "Связь прервалась. Нажмите ещё раз — бонус получат только те, кто не успел.");
    }
    setState("done");
  };

  const off = points !== null && points <= 0;
  return (
    <CrmModal
      title="Приветственный бонус"
      width={460}
      onClose={() => state !== "run" && onClose(state === "done")}
      footer={
        state === "done" ? (
          <button type="button" className="crm-btn primary" onClick={() => onClose(true)}>
            Готово
          </button>
        ) : (
          <>
            <button type="button" className="crm-btn ghost" onClick={() => onClose(false)} disabled={state === "run"}>
              Отмена
            </button>
            <button type="button" className="crm-btn primary" onClick={run} disabled={state === "run" || points === null || off}>
              {state === "run" ? "Начисляю…" : "Начислить"}
            </button>
          </>
        )
      }
    >
      {error && <div className="crm-error">{error}</div>}
      {off && <div className="crm-error">Приветственный бонус не задан в настройках бонусной программы</div>}
      {state === "ask" && points !== null && !off && (
        <span>
          Начислить <b className="num">{num.format(points)}</b> бонусов {count} {clientsDat(count)}?
        </span>
      )}
      {state !== "ask" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span>
            Начислено: <b className="num">{progress.given}</b> {clientsDat(progress.given)}
          </span>
          {progress.skipped > 0 && (
            <span className="muted">
              Пропущено: {progress.skipped} {clientsGen(progress.skipped)} — бонус уже получен или есть покупка
            </span>
          )}
        </div>
      )}
    </CrmModal>
  );
}
