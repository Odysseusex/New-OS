"use client";

import { useEffect, useState } from "react";
import { History, Pencil } from "lucide-react";
import type { DocumentHistoryEntryDto, PurchaseOrderDto, Unit } from "@bakery-os/shared";
import {
  DOCUMENT_HISTORY_LABELS_RU,
  DocumentHistoryKind,
  PURCHASE_ORDER_STATUS_LABELS_RU,
  PURCHASE_REVISION_REASON_MIN,
  PurchaseOrderStatus,
  UNIT_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoneyPrecise, formatQuantity } from "@/lib/format";

const inputClass =
  "w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const unitLabel = (unit: string) => UNIT_LABELS_RU[unit as Unit] ?? unit;

// The purchase order as a document: its lines as ordered and as received, the
// corrections made to it, and «История изменений». A received order is
// corrected here, inside the document (OWNER/ADMIN/ACCOUNTANT); the server
// keeps what it said before.
export function PurchaseOrderDocumentModal({
  order,
  canRevise,
  onClose,
  onChanged,
}: {
  order: PurchaseOrderDto;
  canRevise: boolean;
  onClose: () => void;
  onChanged: (order: PurchaseOrderDto) => void;
}) {
  const [doc, setDoc] = useState(order);
  const [history, setHistory] = useState<DocumentHistoryEntryDto[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<{ quantity: string; unitCost: string }[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHistoryError(null);
    api.procurement
      .orderHistory(doc.id)
      .then((h) => !cancelled && setHistory(h))
      .catch((err) => !cancelled && setHistoryError(err instanceof ApiError ? err.message : "Не удалось загрузить историю"));
    return () => {
      cancelled = true;
    };
  }, [doc.id, reloadToken]);

  const received = doc.status === PurchaseOrderStatus.RECEIVED;
  const actual = (item: PurchaseOrderDto["items"][number]) => ({
    quantity: item.receivedQuantity ?? item.quantity,
    unitCost: item.receivedUnitCost ?? item.unitCost,
  });
  const total = doc.receivedTotal ?? doc.totalCost;

  function startEditing() {
    setRows(doc.items.map((i) => ({ quantity: String(actual(i).quantity), unitCost: String(actual(i).unitCost) })));
    setReason("");
    setError(null);
    setEditing(true);
  }

  const invalid = rows.some((r) => !Number.isFinite(num(r.quantity)) || !Number.isFinite(num(r.unitCost)) || num(r.quantity) < 0 || num(r.unitCost) < 0);
  const newTotal = editing && !invalid ? round2(rows.reduce((s, r) => s + round2(num(r.quantity) * num(r.unitCost)), 0)) : total;
  const changed = editing
    ? doc.items.filter((item, idx) => num(rows[idx].quantity) !== actual(item).quantity || num(rows[idx].unitCost) !== actual(item).unitCost)
    : [];
  const belowPaid = doc.payableRecognized && newTotal < doc.amountPaid - 0.005;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const items = doc.items
        .map((item, idx) => ({ itemId: item.id, quantity: num(rows[idx].quantity), unitCost: num(rows[idx].unitCost) }))
        .filter((line, idx) => line.quantity !== actual(doc.items[idx]).quantity || line.unitCost !== actual(doc.items[idx]).unitCost);
      const updated = await api.procurement.reviseOrder(doc.id, { items, reason: reason.trim() });
      setDoc(updated);
      setEditing(false);
      setReloadToken((t) => t + 1);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось исправить заказ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Заказ поставщику — ${doc.supplierName}`} onClose={onClose} width="max-w-3xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Field label="Статус" value={PURCHASE_ORDER_STATUS_LABELS_RU[doc.status]} />
          <Field label="Точка" value={doc.locationName} />
          <Field label="Дата заказа" value={formatDateTime(doc.orderedAt)} />
          <Field label="Дата приёмки" value={doc.receivedAt ? formatDateTime(doc.receivedAt) : "—"} />
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Товар</th>
                <th className="px-3 py-2 text-right font-medium">Заказано</th>
                <th className="px-3 py-2 text-right font-medium">{received ? "Получено" : "Кол-во"}</th>
                <th className="px-3 py-2 text-right font-medium">Цена</th>
                <th className="px-3 py-2 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {doc.items.map((item, idx) => {
                const a = actual(item);
                const q = editing ? num(rows[idx].quantity) : a.quantity;
                const c = editing ? num(rows[idx].unitCost) : a.unitCost;
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2 text-foreground">{item.productName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-muted">
                      {formatQuantity(item.quantity)} {unitLabel(item.unit)} × {formatMoneyPrecise(item.unitCost)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {editing ? (
                        <input
                          inputMode="decimal"
                          className={inputClass}
                          value={rows[idx].quantity}
                          onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                        />
                      ) : (
                        `${formatQuantity(a.quantity)} ${unitLabel(item.unit)}`
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {editing ? (
                        <input
                          inputMode="decimal"
                          className={inputClass}
                          value={rows[idx].unitCost}
                          onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, unitCost: e.target.value } : r)))}
                        />
                      ) : (
                        formatMoneyPrecise(a.unitCost)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {Number.isFinite(q * c) ? formatMoneyPrecise(round2(q * c)) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="px-3 py-2 text-foreground" colSpan={4}>
                  Итого
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{formatMoneyPrecise(newTotal)}</td>
              </tr>
              {doc.payableRecognized && (
                <tr className="text-muted">
                  <td className="px-3 py-1.5" colSpan={4}>
                    Оплачено / к оплате
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {formatMoneyPrecise(doc.amountPaid)} / {formatMoneyPrecise(round2(Math.max(0, newTotal - doc.amountPaid)))}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {editing ? (
          <div className="space-y-3 rounded-xl border border-border bg-surface-muted p-4">
            {changed.length > 0 && (
              <p className="text-sm text-foreground">
                Разница: <span className="font-semibold">{formatMoneyPrecise(round2(newTotal - total))}</span>
              </p>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Причина исправления</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например: ошибка в цене накладной"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
            {belowPaid && (
              <p className="text-sm text-red-700">Сумма после исправления меньше уже оплаченной — сначала отмените лишнюю оплату.</p>
            )}
            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditing(false)}
                className="rounded-xl border border-border bg-surface px-4 py-2 text-sm text-foreground hover:bg-surface-muted"
              >
                Отмена
              </button>
              <button
                onClick={save}
                disabled={saving || invalid || changed.length === 0 || belowPaid || reason.trim().length < PURCHASE_REVISION_REASON_MIN}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Сохранение…" : "Сохранить исправление"}
              </button>
            </div>
          </div>
        ) : (
          canRevise &&
          received && (
            <div className="flex justify-end">
              <button
                onClick={startEditing}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Pencil className="h-4 w-4" strokeWidth={1.75} />
                Исправить приёмку
              </button>
            </div>
          )
        )}

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <History className="h-4 w-4" strokeWidth={1.75} />
            История изменений
          </h3>
          {historyError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{historyError}</p>}
          {!history && !historyError && <p className="text-sm text-muted">Загрузка…</p>}
          {history && (
            <ol className="divide-y divide-border rounded-xl border border-border">
              {history.map((h, i) => (
                <HistoryRow key={i} entry={h} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}

function HistoryRow({ entry }: { entry: DocumentHistoryEntryDto }) {
  const amountLine =
    entry.amount !== null
      ? formatMoneyPrecise(entry.amount)
      : entry.amountAfter !== null
        ? entry.amountBefore !== null && entry.amountBefore !== entry.amountAfter
          ? `${formatMoneyPrecise(entry.amountBefore)} → ${formatMoneyPrecise(entry.amountAfter)}`
          : formatMoneyPrecise(entry.amountAfter)
        : null;
  const lineLabel = entry.kind === DocumentHistoryKind.RECEIVED ? "заказано → получено" : null;
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">{DOCUMENT_HISTORY_LABELS_RU[entry.kind]}</span>
        <span className="text-xs text-muted">
          {formatDateTime(entry.at)}
          {entry.actorName ? ` · ${entry.actorName}` : ""}
        </span>
      </div>
      {amountLine && <p className="text-foreground">{amountLine}</p>}
      {entry.reason && <p className="text-muted">Причина: {entry.reason}</p>}
      {entry.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {lineLabel && <li>{lineLabel}:</li>}
          {entry.lines.map((l, i) => (
            <li key={i}>
              {l.productName}: {formatQuantity(l.quantityBefore)} {unitLabel(l.unit)} × {formatMoneyPrecise(l.unitCostBefore)} →{" "}
              {formatQuantity(l.quantityAfter)} {unitLabel(l.unit)} × {formatMoneyPrecise(l.unitCostAfter)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
