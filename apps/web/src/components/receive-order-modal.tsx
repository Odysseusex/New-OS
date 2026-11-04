"use client";

import { useEffect, useState } from "react";
import type { CashAccountDto, PurchaseOrderDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney, formatQuantity } from "@/lib/format";
import { enterNext } from "@/lib/keyboard";
import { SubmitShortcutHint } from "@/components/submit-shortcut-hint";

const inputClass =
  "w-28 rounded-lg border border-border bg-surface px-3 py-2 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// Receiving an order = goods in, and (after the purchasing cutover) the debt
// for them. Quantity and price are pre-filled from the order; only what the
// user actually changed is sent, so "as ordered" stays "as ordered".
export function ReceiveOrderModal({
  order,
  canPayNow = false,
  onClose,
  onDone,
}: {
  order: PurchaseOrderDto;
  // The purchasing cutover is on and this user may pay suppliers.
  canPayNow?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [docNumber, setDocNumber] = useState(order.supplierDocNumber ?? "");
  const [payNow, setPayNow] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  useEffect(() => {
    if (!canPayNow) return;
    api.finance.accounts
      .list()
      .then((list) => {
        setAccounts(list);
        setAccountId((cur) => cur || (list.find((a) => a.isDefault) ?? list[0])?.id || "");
      })
      .catch(() => {});
  }, [canPayNow]);
  const [rows, setRows] = useState(
    order.items.map((i) => ({ id: i.id, quantity: String(i.quantity), unitCost: String(i.unitCost) })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
  const total = rows.reduce((s, r) => s + num(r.quantity) * num(r.unitCost), 0);
  const invalid = rows.some((r) => !Number.isFinite(num(r.quantity)) || !Number.isFinite(num(r.unitCost)) || num(r.quantity) < 0 || num(r.unitCost) < 0);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const items = order.items
        .map((item, idx) => {
          const row = rows[idx];
          const q = num(row.quantity);
          const c = num(row.unitCost);
          return {
            itemId: item.id,
            ...(q !== item.quantity ? { quantity: q } : {}),
            ...(c !== item.unitCost ? { unitCost: c } : {}),
          };
        })
        .filter((i) => i.quantity !== undefined || i.unitCost !== undefined);
      await api.procurement.receiveOrder(order.id, {
        items,
        supplierDocNumber: docNumber.trim() !== (order.supplierDocNumber ?? "") ? docNumber.trim() : undefined,
        payNow: canPayNow && payNow && accountId ? { accountId } : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять заказ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Приёмка — ${order.supplierName}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">Товар</th>
              <th className="py-2 text-right font-medium">Заказано</th>
              <th className="py-2 text-right font-medium">Получено</th>
              <th className="py-2 text-right font-medium">Цена</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {order.items.map((item, idx) => (
              <tr key={item.id}>
                <td className="py-2 text-foreground">{item.productName}</td>
                <td className="py-2 text-right text-muted">
                  {formatQuantity(item.quantity)} × {formatMoney(item.unitCost)}
                </td>
                <td className="py-2 text-right">
                  <input
                    {...enterNext}
                    inputMode="decimal"
                    className={inputClass}
                    value={rows[idx].quantity}
                    onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                  />
                </td>
                <td className="py-2 text-right">
                  <input
                    {...enterNext}
                    inputMode="decimal"
                    className={inputClass}
                    value={rows[idx].unitCost}
                    onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, unitCost: e.target.value } : r)))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">№ документа поставщика</span>
          <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} className={inputClass.replace("w-28", "w-full").replace("text-right", "")} />
        </label>
        {canPayNow && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-4 w-4 accent-accent" />
              <span className="text-foreground">Оплачено сразу</span>
            </label>
            {payNow && (
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass.replace("w-28", "w-56").replace("text-right", "")}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Итого по факту</span>
          <span className="font-semibold text-foreground">{formatMoney(Number.isFinite(total) ? total : 0)}</span>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
            Отмена
          </button>
          <button
            data-submit=""
            onClick={submit}
            disabled={saving || invalid}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Приёмка…" : "Принять"}
            {!saving && <SubmitShortcutHint />}
          </button>
        </div>
      </div>
    </Modal>
  );
}
