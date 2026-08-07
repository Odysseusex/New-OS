"use client";

import { useEffect, useState } from "react";
import type { CashAccountDto, CashMovementDto } from "@bakery-os/shared";
import { CASH_MOVEMENT_TYPE_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney } from "@/lib/format";

// The minimal shape every call site (Sales list, накладная, customer card)
// can supply — deliberately not tied to SaleDto/SaleDetailDto/CustomerOrderDto
// directly, since their field names differ (id vs saleId) but the modal only
// ever needs these five values.
export interface SalePaymentContext {
  id: string;
  customerName: string | null;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
}

export function RecordSalePaymentModal({
  sale,
  onClose,
  onPaid,
}: {
  sale: SalePaymentContext;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [payments, setPayments] = useState<CashMovementDto[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(String(sale.balanceDue));
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.finance.accounts.list().then((list) => {
      setAccounts(list);
      setAccountId((prev) => prev || list.find((a) => a.isDefault)?.id || list[0]?.id || "");
    });
    api.sales
      .payments(sale.id)
      .then(setPayments)
      .catch(() => setPayments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) {
      setError("Укажите сумму больше нуля");
      return;
    }
    if (value > sale.balanceDue) {
      setError("Сумма превышает остаток задолженности");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.sales.recordPayment(sale.id, {
        amount: value,
        accountId: accountId || undefined,
        reason: comment.trim() || undefined,
      });
      onPaid();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести оплату");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Получить оплату" onClose={onClose}>
      {sale.customerName && <p className="-mt-3 mb-4 text-sm text-muted">{sale.customerName}</p>}

      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatTile label="Сумма продажи" value={formatMoney(sale.totalAmount)} />
        <StatTile label="Уже оплачено" value={formatMoney(sale.amountPaid)} />
        <StatTile label="Остаток" value={formatMoney(sale.balanceDue)} highlight={sale.balanceDue > 0} />
      </div>

      {payments && payments.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">История платежей</h3>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-muted">{formatDateTime(p.occurredAt)}</td>
                    <td className="px-3 py-2 text-muted">{CASH_MOVEMENT_TYPE_LABELS_RU[p.type]}</td>
                    <td className="px-3 py-2 text-muted">{p.accountName}</td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sale.balanceDue <= 0 ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Продажа полностью оплачена.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Сумма к внесению</label>
            <input
              type="number"
              min="0"
              max={sale.balanceDue}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Счёт зачисления</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {accounts.length === 0 && <option value="">Нет доступных счетов</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Комментарий <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: Kaspi Business"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? "Сохранение…" : "Получить оплату"}
          </button>
        </form>
      )}
    </Modal>
  );
}

function StatTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-muted px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${highlight ? "text-red-600" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
