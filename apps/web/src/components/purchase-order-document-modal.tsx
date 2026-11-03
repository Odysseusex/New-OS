"use client";

import { useEffect, useState } from "react";
import { History, Pencil, Undo2 } from "lucide-react";
import type { CashAccountDto, DocumentHistoryEntryDto, PurchaseOrderDto, Unit } from "@bakery-os/shared";
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
import { enterNext } from "@/lib/keyboard";
import { SubmitShortcutHint } from "@/components/submit-shortcut-hint";

const inputClass =
  "w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const unitLabel = (unit: string) => UNIT_LABELS_RU[unit as Unit] ?? unit;

// The purchase order as a document: its lines as ordered and as received, the
// corrections made to it, and «История изменений». A received order is
// corrected here, inside the document (OWNER/ADMIN/ACCOUNTANT); the server
// keeps what it said before. «Возврат поставщику» hands goods of a received
// order back (same roles): a separate document, the order itself unchanged.
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
  const [returning, setReturning] = useState(false);
  const [returnRows, setReturnRows] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [refundAccountId, setRefundAccountId] = useState("");
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

  // What is left of a line to hand back, and what handing it back is worth.
  const returnable = (item: PurchaseOrderDto["items"][number]) => Math.max(0, Math.round((actual(item).quantity - item.returnedQuantity) * 1000) / 1000);
  const returnLines = returning
    ? doc.items
        .map((item, idx) => ({ item, quantity: returnRows[idx] === undefined || returnRows[idx].trim() === "" ? 0 : num(returnRows[idx]) }))
        .filter((l) => l.quantity !== 0)
    : [];
  const returnInvalid = returnLines.some((l) => !Number.isFinite(l.quantity) || l.quantity < 0 || l.quantity > returnable(l.item) + 0.0005);
  const credited = returnInvalid ? 0 : round2(returnLines.reduce((s, l) => s + round2(l.quantity * actual(l.item).unitCost), 0));
  const refund = doc.payableRecognized ? round2(Math.max(0, credited - doc.balanceDue)) : 0;

  function startReturning() {
    setReturnRows(doc.items.map(() => ""));
    setReason("");
    setError(null);
    setReturning(true);
    if (accounts.length === 0) {
      api.finance.accounts
        .list()
        .then((list) => {
          setAccounts(list);
          setRefundAccountId((prev) => prev || list.find((a) => a.isDefault)?.id || list[0]?.id || "");
        })
        .catch(() => {});
    }
  }

  async function saveReturn() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.procurement.returnToSupplier(doc.id, {
        items: returnLines.map((l) => ({ itemId: l.item.id, quantity: l.quantity })),
        reason: reason.trim(),
        refundAccountId: refund > 0 ? refundAccountId : undefined,
      });
      setDoc(updated);
      setReturning(false);
      setReloadToken((t) => t + 1);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось оформить возврат");
    } finally {
      setSaving(false);
    }
  }

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
                          {...enterNext}
                          inputMode="decimal"
                          className={inputClass}
                          value={rows[idx].quantity}
                          onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                        />
                      ) : (
                        <>
                          {formatQuantity(a.quantity)} {unitLabel(item.unit)}
                          {item.returnedQuantity > 0 && (
                            <div className="text-xs text-muted">
                              возвращено {formatQuantity(item.returnedQuantity)} {unitLabel(item.unit)}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                      {editing ? (
                        <input
                          {...enterNext}
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
              {doc.returnedTotal > 0 && (
                <tr className="text-muted">
                  <td className="px-3 py-1.5" colSpan={4}>
                    Возвращено поставщику{doc.refundedTotal > 0 ? ` (деньги возвращены: ${formatMoneyPrecise(doc.refundedTotal)})` : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">−{formatMoneyPrecise(doc.returnedTotal)}</td>
                </tr>
              )}
              {doc.payableRecognized && (
                <tr className="text-muted">
                  <td className="px-3 py-1.5" colSpan={4}>
                    Оплачено / к оплате
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {formatMoneyPrecise(doc.amountPaid)} /{" "}
                    {formatMoneyPrecise(editing ? round2(Math.max(0, newTotal - doc.amountPaid)) : doc.balanceDue)}
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
                {...enterNext}
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
                data-submit=""
                onClick={save}
                disabled={saving || invalid || changed.length === 0 || belowPaid || reason.trim().length < PURCHASE_REVISION_REASON_MIN}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Сохранение…" : "Сохранить исправление"}
                {!saving && <SubmitShortcutHint />}
              </button>
            </div>
          </div>
        ) : returning ? (
          <div className="space-y-3 rounded-xl border border-border bg-surface-muted p-4">
            <p className="text-sm font-semibold text-foreground">Возврат поставщику</p>
            <div className="space-y-2">
              {doc.items.map((item, idx) => {
                const left = returnable(item);
                const q = returnRows[idx] ? num(returnRows[idx]) : 0;
                const tooMuch = Number.isFinite(q) && q > left + 0.0005;
                return (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 text-foreground">
                      {item.productName}
                      <span className="ml-2 text-xs text-muted">
                        можно вернуть {formatQuantity(left)} {unitLabel(item.unit)} × {formatMoneyPrecise(actual(item).unitCost)}
                      </span>
                    </span>
                    <input
                      {...enterNext}
                      inputMode="decimal"
                      disabled={left <= 0}
                      placeholder="0"
                      className={`${inputClass} ${tooMuch ? "border-red-400" : ""}`}
                      value={returnRows[idx] ?? ""}
                      onChange={(e) => setReturnRows(returnRows.map((r, i) => (i === idx ? e.target.value : r)))}
                    />
                    <span className="w-28 whitespace-nowrap text-right text-foreground">
                      {q > 0 && !tooMuch ? formatMoneyPrecise(round2(q * actual(item).unitCost)) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
            {credited > 0 && (
              <p className="text-sm text-foreground">
                Возврат на сумму <span className="font-semibold">{formatMoneyPrecise(credited)}</span>
                {doc.payableRecognized && refund === 0 && " — долг поставщику уменьшится на эту сумму"}
              </p>
            )}
            {refund > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-foreground">
                  Заказ уже оплачен — поставщик возвращает деньги: <span className="font-semibold">{formatMoneyPrecise(refund)}</span> на счёт
                </span>
                <select
                  value={refundAccountId}
                  onChange={(e) => setRefundAccountId(e.target.value)}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  {accounts
                    .filter((a) => a.isActive)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {!doc.payableRecognized && credited > 0 && (
              <p className="text-sm text-amber-700">Заказ принят до перехода на новый порядок закупок: товар спишется со склада, деньги здесь не учитываются.</p>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Причина возврата</label>
              <input
                {...enterNext}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например: порванные мешки"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setReturning(false)}
                className="rounded-xl border border-border bg-surface px-4 py-2 text-sm text-foreground hover:bg-surface-muted"
              >
                Отмена
              </button>
              <button
                data-submit=""
                onClick={saveReturn}
                disabled={
                  saving ||
                  returnInvalid ||
                  returnLines.length === 0 ||
                  (refund > 0 && !refundAccountId) ||
                  reason.trim().length < PURCHASE_REVISION_REASON_MIN
                }
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Сохранение…" : "Оформить возврат"}
                {!saving && <SubmitShortcutHint />}
              </button>
            </div>
          </div>
        ) : (
          canRevise &&
          received && (
            <div className="flex flex-wrap justify-end gap-2">
              {doc.items.some((i) => returnable(i) > 0) && (
                <button
                  onClick={startReturning}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
                >
                  <Undo2 className="h-4 w-4" strokeWidth={1.75} />
                  Возврат поставщику
                </button>
              )}
              {doc.returnCount === 0 && (
                <button
                  onClick={startEditing}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                  Исправить приёмку
                </button>
              )}
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

const isReturnKind = (entry: DocumentHistoryEntryDto) => entry.kind === DocumentHistoryKind.SUPPLIER_RETURN;

function HistoryRow({ entry }: { entry: DocumentHistoryEntryDto }) {
  const amountLine = isReturnKind(entry)
    ? `−${formatMoneyPrecise(-(entry.amountAfter ?? 0))}${entry.amount !== null ? ` · деньги возвращены: ${formatMoneyPrecise(entry.amount)}` : ""}`
    : entry.amount !== null
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
          {entry.lines.map((l, i) =>
            isReturnKind(entry) ? (
              <li key={i}>
                {l.productName}: {formatQuantity(l.quantityBefore)} {unitLabel(l.unit)} × {formatMoneyPrecise(l.unitCostBefore)}
              </li>
            ) : (
              <li key={i}>
                {l.productName}: {formatQuantity(l.quantityBefore)} {unitLabel(l.unit)} × {formatMoneyPrecise(l.unitCostBefore)} →{" "}
                {formatQuantity(l.quantityAfter)} {unitLabel(l.unit)} × {formatMoneyPrecise(l.unitCostAfter)}
              </li>
            ),
          )}
        </ul>
      )}
    </li>
  );
}
