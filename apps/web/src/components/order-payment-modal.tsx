"use client";

import { useEffect, useState } from "react";
import { HARD_DELETE_ROLES, SUPPLIER_PAYMENT_ROLES } from "@bakery-os/shared";
import type { CashAccountDto, PurchaseOrderDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney } from "@/lib/format";

const fieldClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// Payments against a received order: history with reversal, plus a new payment.
// A payment is never edited or deleted — «Отменить» records the money coming
// back as its own movement and the order owes the amount again.
export function OrderPaymentModal({
  order: initial,
  onClose,
  onChanged,
}: {
  order: PurchaseOrderDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const canPay = user ? SUPPLIER_PAYMENT_ROLES.includes(user.role) : false;
  const canReverse = user ? HARD_DELETE_ROLES.includes(user.role) : false;
  const [order, setOrder] = useState(initial);
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(String(initial.balanceDue));
  const [note, setNote] = useState("");
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.finance.accounts
      .list()
      .then((list) => {
        setAccounts(list);
        setAccountId((current) => current || list[0]?.id || "");
      })
      .catch(() => setError("Не удалось загрузить счета"));
  }, []);

  async function run(action: () => Promise<PurchaseOrderDto>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setOrder(next);
      setAmount(String(next.balanceDue));
      setReversing(null);
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
    }
  }

  const value = Number(amount.replace(",", "."));

  return (
    <Modal title={`Оплата — ${order.supplierName}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Получено на сумму" value={formatMoney(order.receivedTotal ?? order.totalCost)} />
          <Stat label="Оплачено" value={formatMoney(order.amountPaid)} />
          <Stat label="К оплате" value={formatMoney(order.balanceDue)} />
        </div>

        {order.payments.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Дата</th>
                <th className="py-2 font-medium">Счёт</th>
                <th className="py-2 text-right font-medium">Сумма</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.payments.map((p) => (
                <tr key={p.id} className={p.reversedAt ? "text-muted line-through" : "text-foreground"}>
                  <td className="py-2">{formatDateTime(p.paidAt)}</td>
                  <td className="py-2">{p.accountName}</td>
                  <td className="py-2 text-right">{formatMoney(p.amount)}</td>
                  <td className="py-2 text-right no-underline">
                    {p.reversedAt ? (
                      <span className="text-xs text-muted">Отменён: {p.reversalReason}</span>
                    ) : (
                      canReverse &&
                      (reversing === p.id ? (
                        <span className="flex items-center justify-end gap-2">
                          <input
                            className="w-40 rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
                            placeholder="Причина"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                          <button
                            disabled={busy || reason.trim().length < 3}
                            onClick={() => run(() => api.procurement.reversePayment(order.id, p.id, { reason: reason.trim() }))}
                            className="rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Отменить
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setReversing(p.id)} className="text-xs text-red-700 hover:underline">
                          Отменить платёж
                        </button>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canPay && order.balanceDue > 0 && (
          <div className="space-y-3 rounded-2xl border border-border p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Счёт</span>
                <select className={fieldClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Сумма</span>
                <input className={fieldClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            </div>
            <input className={fieldClass} placeholder="Комментарий (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              disabled={busy || !accountId || !(value > 0) || value > order.balanceDue + 0.005}
              onClick={() => run(() => api.procurement.payOrder(order.id, { accountId, amount: value, note: note.trim() || undefined }))}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              Оплатить
            </button>
          </div>
        )}

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-semibold text-foreground">{value}</div>
    </div>
  );
}
