"use client";

import { useCallback, useEffect, useState } from "react";
import { Cake, Plus } from "lucide-react";
import { CRM_ORDER_STAGE_LABELS_RU, CRM_ORDER_STAGES, CrmOrderDto, CrmOrderStage } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useCrm } from "@/components/crm/shell";
import { OrderDialog } from "@/components/crm/order-dialog";
import { Avatar, ErrorBox, fmtMoney, fmtWhen, PageHeader, Skeleton, Tag, Tone } from "@/components/crm/ui";

const STAGE_TONES: Record<CrmOrderStage, Tone> = {
  [CrmOrderStage.NEW]: "gray",
  [CrmOrderStage.AGREED]: "blue",
  [CrmOrderStage.PREPAID]: "orange",
  [CrmOrderStage.IN_PRODUCTION]: "purple",
  [CrmOrderStage.READY]: "green",
  [CrmOrderStage.DONE]: "yellow",
  [CrmOrderStage.CANCELLED]: "red",
};

const DAY = 86_400_000;

function dueTone(order: CrmOrderDto): Tone {
  if (order.stage === CrmOrderStage.DONE) return "gray";
  const left = new Date(order.dueAt).getTime() - Date.now();
  if (left < 0) return "red";
  if (left < DAY) return "orange";
  return "gray";
}

export default function CrmOrdersPage() {
  const { refreshCounts } = useCrm();
  const [orders, setOrders] = useState<CrmOrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CrmOrderDto | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<CrmOrderStage | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.crm
      .orders()
      .then(setOrders)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить"));
  }, []);
  useEffect(() => load(), [load]);

  const move = async (id: string, stage: CrmOrderStage) => {
    const current = orders?.find((o) => o.id === id);
    if (!current || current.stage === stage) return;
    // Moved on screen at once; put back if the server refuses.
    setOrders((list) => list?.map((o) => (o.id === id ? { ...o, stage } : o)) ?? null);
    try {
      const saved = await api.crm.updateOrder(id, { stage });
      setOrders((list) => list?.map((o) => (o.id === id ? saved : o)) ?? null);
      refreshCounts();
    } catch (e) {
      setOrders((list) => list?.map((o) => (o.id === id ? current : o)) ?? null);
      setError(e instanceof ApiError ? e.message : "Не удалось перенести заказ");
    }
  };

  const active = orders?.filter((o) => o.stage !== CrmOrderStage.CANCELLED) ?? [];

  return (
    <div className="crm-wrap" style={{ maxWidth: 1600 }}>
      <PageHeader icon={<Cake size={30} strokeWidth={1.6} />} tone="pink" title="Торты на заказ" subtitle={orders ? `${active.filter((o) => o.stage !== CrmOrderStage.DONE).length} в работе` : undefined}>
        <button type="button" className="crm-btn primary" onClick={() => setEditing("new")}>
          <Plus size={15} /> Новый заказ
        </button>
      </PageHeader>
      {error && <ErrorBox message={error} onRetry={load} />}

      <section className="crm-board scroll" aria-label="Заказы по этапам">
        {CRM_ORDER_STAGES.map((stage) => {
          const tone = STAGE_TONES[stage];
          const list = active.filter((o) => o.stage === stage);
          return (
            <div
              key={stage}
              className={`crm-col${over === stage ? " drop" : ""}`}
              style={{ background: `color-mix(in srgb, var(--${tone}-bg) var(--col), transparent)` }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragId) void move(dragId, stage);
                setDragId(null);
              }}
            >
              <div className="crm-colhead">
                <Tag tone={tone}>{CRM_ORDER_STAGE_LABELS_RU[stage]}</Tag>
                {orders && <span className="num" style={{ color: `var(--${tone})`, fontWeight: 500, fontSize: 13.5 }}>{list.length}</span>}
              </div>
              {!orders && !error && <Skeleton height={90} />}
              {list.map((o) => (
                <article
                  key={o.id}
                  className={`crm-card clickable${dragId === o.id ? " dragging" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    setDragId(o.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => setEditing(o)}
                  onKeyDown={(e) => e.key === "Enter" && setEditing(o)}
                  tabIndex={0}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="muted num" style={{ fontSize: 12.5 }}>№{o.number}</span>
                    <span style={{ fontWeight: 500, flex: 1, minWidth: 0 }}>{o.title}</span>
                  </div>
                  {o.details && <span className="tx2" style={{ fontSize: 13.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{o.details}</span>}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar name={o.customerName} size={20} />
                    <span style={{ fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customerName}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="crm-mini" style={{ background: `var(--${dueTone(o)}-bg)`, color: dueTone(o) === "gray" ? undefined : `var(--${dueTone(o)})` }}>{fmtWhen(o.dueAt)}</span>
                    {o.weightKg && <span className="crm-mini num">{String(o.weightKg).replace(".", ",")} кг</span>}
                    {o.price && <span className="crm-mini num">{fmtMoney(o.price)}</span>}
                    {o.prepaid && <span className="crm-mini" style={{ background: "var(--green-bg)", color: "var(--green)" }}>предоплата</span>}
                  </div>
                </article>
              ))}
              {orders && list.length === 0 && <div className="crm-empty">Перетащите сюда</div>}
            </div>
          );
        })}
      </section>

      {editing && (
        <OrderDialog
          order={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            refreshCounts();
          }}
        />
      )}
    </div>
  );
}
