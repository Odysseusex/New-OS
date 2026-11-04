"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { FileText, Plus, Trash2 } from "lucide-react";
import type { LocationDto, MaterialRequisitionDto, ProductDto, RequisitionIssueReportDto, RequisitionPlanBatchDto } from "@bakery-os/shared";
import {
  LocationType,
  MATERIAL_REQUISITION_CREATE_ROLES,
  MATERIAL_REQUISITION_POST_ROLES,
  MATERIAL_REQUISITION_STATUS_LABELS_RU,
  MaterialRequisitionStatus,
  ORG_WIDE_ROLES,
  ProductType,
  UNIT_LABELS_RU,
  Unit,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { zonedDateKey } from "@/lib/reporting-period";
import { downloadTable, withExportTarget } from "@/lib/export-table";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";

const field =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

interface LineState {
  productId: string;
  productName: string;
  unit: Unit;
  requiredQuantity: number | null;
  quantity: string;
  fromStock: number | null;
  toStock: number | null;
}

const toLines = (lines: MaterialRequisitionDto["lines"]): LineState[] =>
  lines.map((l) => ({ ...l, quantity: String(l.quantity) }));

function printRequisition(r: MaterialRequisitionDto) {
  withExportTarget("pdf", () =>
    downloadTable(
      `trebovanie-${r.number}`,
      ["Сырьё", "Ед.", "Требуется по техкартам", "Отпущено", "Получено"],
      r.lines.map((l) => [l.productName, UNIT_LABELS_RU[l.unit], l.requiredQuantity ?? "—", l.quantity, ""]),
      {
        sheetName: "Требование",
        titleLines: [
          `Требование-накладная №${r.number} от ${formatDate(r.planDate)}`,
          `Отправитель: ${r.fromLocationName} · Получатель: ${r.toLocationName}`,
          `Составил: ${r.createdByName}${r.postedByName ? ` · Отпустил: ${r.postedByName}, ${formatDateTime(r.postedAt!)}` : ""}`,
          ...(r.note ? [`Примечание: ${r.note}`] : []),
        ],
      },
    ),
  );
}

// Производство → «Требования»: требования-накладные цеха на склад.
export function RequisitionsTab({ locations, products }: { locations: LocationDto[]; products: ProductDto[] }) {
  const { user } = useAuth();
  const canCreate = user ? MATERIAL_REQUISITION_CREATE_ROLES.includes(user.role) : false;
  const [rows, setRows] = useState<MaterialRequisitionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MaterialRequisitionDto | "new" | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.requisitions
      .list()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить требования"));
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        {canCreate && (
          <button
            onClick={() => setOpen("new")}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Новое требование
          </button>
        )}
      </div>
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-5 py-3 font-medium">№</th>
              <th className="px-5 py-3 font-medium">На дату</th>
              <th className="px-5 py-3 font-medium">Склад → цех</th>
              <th className="px-5 py-3 text-right font-medium">Строк</th>
              <th className="px-5 py-3 font-medium">Статус</th>
              <th className="px-5 py-3 font-medium">Составил</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(rows ?? []).map((r) => (
              <tr key={r.id} onClick={() => setOpen(r)} className="cursor-pointer hover:bg-surface-muted">
                <td className="px-5 py-3 font-medium text-foreground">{r.number}</td>
                <td className="px-5 py-3 text-muted">{formatDate(r.planDate)}</td>
                <td className="px-5 py-3 text-foreground">
                  {r.fromLocationName} → {r.toLocationName}
                </td>
                <td className="px-5 py-3 text-right text-muted">{r.lines.length}</td>
                <td className="px-5 py-3">
                  <span
                    className={clsx(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      r.status === MaterialRequisitionStatus.POSTED ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                    )}
                  >
                    {MATERIAL_REQUISITION_STATUS_LABELS_RU[r.status]}
                  </span>
                  {r.postedAt && <p className="mt-1 text-xs text-muted">{formatDateTime(r.postedAt)}</p>}
                </td>
                <td className="px-5 py-3 text-muted">{r.createdByName}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted">
                  Требований пока нет
                </td>
              </tr>
            )}
            {!rows && !error && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted">
                  Загрузка…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <RequisitionModal
          requisition={open === "new" ? null : open}
          locations={locations}
          products={products}
          onClose={() => setOpen(null)}
          onChanged={(r) => {
            load();
            if (r) setOpen(r);
            else setOpen(null);
          }}
        />
      )}
      <IssueReconciliationCard locations={locations} />
    </div>
  );
}

function RequisitionModal({
  requisition,
  locations,
  products,
  onClose,
  onChanged,
}: {
  requisition: MaterialRequisitionDto | null;
  locations: LocationDto[];
  products: ProductDto[];
  onClose: () => void;
  onChanged: (r: MaterialRequisitionDto | null) => void;
}) {
  const { user } = useAuth();
  const canCreate = user ? MATERIAL_REQUISITION_CREATE_ROLES.includes(user.role) : false;
  const canPost = user ? MATERIAL_REQUISITION_POST_ROLES.includes(user.role) : false;
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const isNew = requisition === null;
  const editable = canCreate && (isNew || requisition.status === MaterialRequisitionStatus.DRAFT);
  const active = locations.filter((l) => l.isActive !== false);

  const [fromId, setFromId] = useState(requisition?.fromLocationId ?? "");
  const [toId, setToId] = useState(requisition?.toLocationId ?? "");
  const [date, setDate] = useState(requisition?.planDate ?? zonedDateKey());
  const [note, setNote] = useState(requisition?.note ?? "");
  const [lines, setLines] = useState<LineState[]>(requisition ? toLines(requisition.lines) : []);
  const [batches, setBatches] = useState<RequisitionPlanBatchDto[]>([]);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Defaults once the locations arrive: a warehouse as the sender, the user's own
  // point (or a production one) as the workshop.
  useEffect(() => {
    if (!isNew || active.length === 0) return;
    if (!fromId) setFromId((active.find((l) => l.type === LocationType.WAREHOUSE) ?? active[0]).id);
    if (!toId) {
      const own = !isOrgWide && user?.locationId ? user.locationId : null;
      setToId(own ?? (active.find((l) => l.type === LocationType.BAKERY_PRODUCTION) ?? active[1] ?? active[0]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, active.length]);

  // A new requisition is filled from the day's plan; ticking tasks off recalculates.
  const chosenKey = chosen ? Array.from(chosen).sort().join(",") : "*";
  useEffect(() => {
    if (!isNew || !fromId || !toId || fromId === toId || !date) return;
    if (chosen && chosen.size === 0) {
      setLines((prev) => prev.filter((l) => l.requiredQuantity === null));
      return;
    }
    let cancelled = false;
    api.requisitions
      .need({ fromLocationId: fromId, toLocationId: toId, date, batchIds: chosen ? Array.from(chosen) : undefined })
      .then((need) => {
        if (cancelled) return;
        setBatches(need.batches);
        setMissing(need.missing);
        if (!chosen) setChosen(new Set(need.batches.map((b) => b.id)));
        setLines((prev) => [
          ...need.lines.map((l) => ({ ...l, quantity: String(l.quantity) })),
          ...prev.filter((l) => l.requiredQuantity === null && !need.lines.some((n) => n.productId === l.productId)),
        ]);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось рассчитать потребность"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, fromId, toId, date, chosenKey]);

  // A different workshop or day is a different plan: start the task list over.
  useEffect(() => {
    if (isNew) setChosen(null);
  }, [isNew, toId, date]);

  const pickable = useMemo(
    () =>
      products.filter(
        (p) => p.isActive !== false && p.trackInventory !== false && p.type !== ProductType.FINISHED_GOOD && !lines.some((l) => l.productId === p.id),
      ),
    [products, lines],
  );

  function addLine(productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setLines((prev) => [...prev, { productId, productName: p.name, unit: p.unit, requiredQuantity: null, quantity: "", fromStock: null, toStock: null }]);
    setAdding("");
  }

  const payloadLines = () =>
    lines.map((l) => {
      const q = Number(l.quantity.replace(",", ".") || "0");
      if (!Number.isFinite(q) || q < 0) throw new Error(`Неверное количество: ${l.productName}`);
      return { productId: l.productId, requiredQuantity: l.requiredQuantity, quantity: q };
    });

  async function save(andPost: boolean) {
    setError(null);
    setBusy(true);
    try {
      let saved: MaterialRequisitionDto;
      if (isNew) {
        saved = await api.requisitions.create({
          fromLocationId: fromId,
          toLocationId: toId,
          planDate: date,
          batchIds: chosen ? Array.from(chosen) : [],
          note: note.trim() || undefined,
          lines: payloadLines(),
        });
      } else {
        saved = await api.requisitions.update(requisition.id, { note, lines: payloadLines() });
      }
      if (andPost) {
        try {
          saved = await api.requisitions.post(saved.id);
        } catch (err) {
          // The draft is saved; show it with the reason it could not be issued.
          setLines(toLines(saved.lines));
          onChanged(saved);
          setError(err instanceof ApiError ? err.message : "Не удалось провести");
          return;
        }
      }
      setLines(toLines(saved.lines));
      onChanged(saved);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!requisition || !confirm(`Удалить черновик требования №${requisition.number}?`)) return;
    setBusy(true);
    try {
      await api.requisitions.remove(requisition.id);
      onChanged(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
      setBusy(false);
    }
  }

  const title = isNew
    ? "Новое требование-накладная"
    : `Требование-накладная №${requisition.number} · ${MATERIAL_REQUISITION_STATUS_LABELS_RU[requisition.status]}`;
  const showStock = isNew || requisition?.status === MaterialRequisitionStatus.DRAFT;

  return (
    <Modal title={title} onClose={onClose} width="max-w-3xl">
      {isNew ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-foreground">Склад (отпускает)</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={clsx(field, "w-full")}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-foreground">Цех (получает)</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={clsx(field, "w-full")}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-foreground">План выпуска на</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={clsx(field, "w-full")} />
          </label>
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted">
          {requisition.fromLocationName} → {requisition.toLocationName} · план на {formatDate(requisition.planDate)} · составил{" "}
          {requisition.createdByName}
          {requisition.postedByName && ` · отпустил ${requisition.postedByName}, ${formatDateTime(requisition.postedAt!)}`}
        </p>
      )}

      {isNew && fromId === toId && fromId && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">Склад и цех должны быть разными точками</p>}

      {isNew && batches.length > 0 && (
        <div className="mb-4 rounded-xl bg-surface-muted p-3">
          <p className="mb-2 text-sm font-medium text-foreground">Задания на этот день</p>
          <div className="space-y-1">
            {batches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen?.has(b.id) ?? true}
                  onChange={() =>
                    setChosen((prev) => {
                      const next = new Set(prev ?? batches.map((x) => x.id));
                      if (next.has(b.id)) next.delete(b.id);
                      else next.add(b.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 accent-accent"
                />
                <span className="text-foreground">{b.productName}</span>
                <span className="text-muted">
                  {formatQuantity(b.plannedQuantity)} {UNIT_LABELS_RU[b.unit]}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {isNew && batches.length === 0 && fromId !== toId && (
        <p className="mb-3 text-sm text-muted">На этот день в цехе нет запланированных заданий — строки можно добавить вручную.</p>
      )}
      {missing.length > 0 && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">Нет активной техкарты: {missing.join(", ")}</p>
      )}

      <div className="mb-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3 font-medium">Сырьё</th>
              <th className="py-2 pr-3 text-right font-medium">По техкартам</th>
              {showStock && <th className="py-2 pr-3 text-right font-medium">На складе</th>}
              {showStock && <th className="py-2 pr-3 text-right font-medium">В цехе</th>}
              <th className="py-2 pr-3 text-right font-medium">{editable ? "Выдать" : "Отпущено"}</th>
              {editable && <th className="w-8" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l, i) => {
              const q = Number(l.quantity.replace(",", "."));
              const short = l.fromStock !== null && Number.isFinite(q) && q > l.fromStock;
              return (
                <tr key={l.productId}>
                  <td className="py-2 pr-3 text-foreground">{l.productName}</td>
                  <td className="py-2 pr-3 text-right text-muted">
                    {l.requiredQuantity !== null ? `${formatQuantity(l.requiredQuantity)} ${UNIT_LABELS_RU[l.unit]}` : "—"}
                  </td>
                  {showStock && (
                    <td className={clsx("py-2 pr-3 text-right", short ? "font-medium text-red-600" : "text-muted")}>
                      {l.fromStock !== null ? formatQuantity(l.fromStock) : "—"}
                    </td>
                  )}
                  {showStock && <td className="py-2 pr-3 text-right text-muted">{l.toStock !== null ? formatQuantity(l.toStock) : "—"}</td>}
                  <td className="py-2 pr-3 text-right">
                    {editable ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          inputMode="decimal"
                          value={l.quantity}
                          onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                          className={clsx(field, "w-24 text-right")}
                        />
                        <span className="w-8 text-left text-xs text-muted">{UNIT_LABELS_RU[l.unit]}</span>
                      </span>
                    ) : (
                      `${formatQuantity(Number(l.quantity))} ${UNIT_LABELS_RU[l.unit]}`
                    )}
                  </td>
                  {editable && (
                    <td>
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-red-600"
                        title="Убрать строку"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  Строк нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="mb-4 max-w-sm">
          <ProductSelect products={pickable} value={adding} onChange={addLine} placeholder="Добавить сырьё…" />
        </div>
      )}

      {editable ? (
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium text-foreground">Примечание</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={clsx(field, "w-full")} />
        </label>
      ) : (
        requisition?.note && <p className="mb-4 text-sm text-muted">Примечание: {requisition.note}</p>
      )}

      {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button
            type="button"
            disabled={busy || lines.length === 0 || (isNew && (!fromId || !toId || fromId === toId))}
            onClick={() => save(false)}
            className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
          >
            Сохранить черновик
          </button>
        )}
        {editable && canPost && (
          <button
            type="button"
            data-submit
            disabled={busy || lines.length === 0 || (isNew && (!fromId || !toId || fromId === toId))}
            onClick={() => save(true)}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Проводим…" : "Провести (выдать со склада)"}
          </button>
        )}
        {requisition && (
          <button
            type="button"
            onClick={() => printRequisition(requisition)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            Печать
          </button>
        )}
        {requisition && editable && (
          <button type="button" disabled={busy} onClick={remove} className="ml-auto text-sm text-red-600 hover:underline disabled:opacity-50">
            Удалить черновик
          </button>
        )}
      </div>
    </Modal>
  );
}

// Сверка выдачи (ТЗ §4): what the warehouse issued to a workshop by requisitions over a
// period against the norm of what its completed batches produced. Above zero = issued
// beyond the norm (the difference sits in the workshop or went into overuse).
function IssueReconciliationCard({ locations }: { locations: LocationDto[] }) {
  const workshops = useMemo(() => locations.filter((l) => l.isActive !== false), [locations]);
  const today = zonedDateKey();
  const [locationId, setLocationId] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<RequisitionIssueReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId && workshops.length > 0) {
      setLocationId((workshops.find((l) => l.type === "BAKERY_PRODUCTION") ?? workshops[0]).id);
    }
  }, [workshops, locationId]);

  useEffect(() => {
    if (!locationId || !from || !to) return;
    setError(null);
    api.requisitions
      .issueReport(locationId, from, to)
      .then(setReport)
      .catch((err) => {
        setReport(null);
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить сверку");
      });
  }, [locationId, from, to]);

  function exportTable() {
    if (!report) return;
    const point = workshops.find((l) => l.id === report.locationId)?.name ?? "";
    void downloadTable(
      `sverka-vydachi-${report.from}-${report.to}`,
      ["Сырьё", "Ед.", "Выдано", "Выдано, ₸", "Норма на выпуск", "Норма, ₸", "Факт расхода", "Выдано сверх нормы", "Сверх нормы, ₸"],
      report.lines.map((l) => [
        l.productName,
        UNIT_LABELS_RU[l.unit],
        l.issued,
        { v: l.issuedValue, fmt: "money" as const },
        l.norm,
        { v: l.normValue, fmt: "money" as const },
        l.actual,
        l.overIssued,
        { v: l.overIssuedValue, fmt: "money" as const },
      ]),
      { sheetName: "Сверка выдачи", titleLines: [`Сверка выдачи · ${point}`, `${formatDate(report.from)} — ${formatDate(report.to)}`] },
    );
  }

  const field = "rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Сверка выдачи с нормой выпуска</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={field}>
            {workshops.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          <button onClick={exportTable} disabled={!report} className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50">
            Excel
          </button>
          <button
            onClick={() => withExportTarget("pdf", exportTable)}
            disabled={!report}
            className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
          >
            PDF
          </button>
        </div>
      </div>
      {error && <p className="px-5 py-4 text-sm text-red-700">{error}</p>}
      {report && report.lines.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted">За период нет выдачи и выпуска</p>}
      {report && report.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Сырьё</th>
                <th className="px-5 py-3 text-right font-medium">Выдано</th>
                <th className="px-5 py-3 text-right font-medium">Норма на выпуск</th>
                <th className="px-5 py-3 text-right font-medium">Факт расхода</th>
                <th className="px-5 py-3 text-right font-medium">Сверх нормы</th>
                <th className="px-5 py-3 text-right font-medium">Сверх нормы, ₸</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.lines.map((l) => {
                const u = UNIT_LABELS_RU[l.unit];
                return (
                  <tr key={l.productId}>
                    <td className="px-5 py-3 text-foreground">{l.productName}</td>
                    <td className="px-5 py-3 text-right text-foreground">{formatQuantity(l.issued)} {u}</td>
                    <td className="px-5 py-3 text-right text-foreground">{formatQuantity(l.norm)} {u}</td>
                    <td className="px-5 py-3 text-right text-muted">{formatQuantity(l.actual)} {u}</td>
                    <td className={clsx("px-5 py-3 text-right font-medium", l.overIssued > 0 ? "text-red-700" : l.overIssued < 0 ? "text-emerald-700" : "text-foreground")}>
                      {l.overIssued > 0 ? "+" : ""}
                      {formatQuantity(l.overIssued)} {u}
                    </td>
                    <td className={clsx("px-5 py-3 text-right", l.overIssuedValue > 0 ? "text-red-700" : "text-foreground")}>{formatMoney(l.overIssuedValue)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-border bg-surface-muted text-sm font-semibold">
              <tr>
                <td className="px-5 py-3 text-foreground">Итого</td>
                <td className="px-5 py-3 text-right text-foreground">{formatMoney(report.totals.issuedValue)}</td>
                <td className="px-5 py-3 text-right text-foreground">{formatMoney(report.totals.normValue)}</td>
                <td />
                <td />
                <td className="px-5 py-3 text-right text-foreground">{formatMoney(report.totals.overIssuedValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
