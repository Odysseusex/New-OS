"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { CustomerDetailDto } from "@bakery-os/shared";
import { PAYMENT_STATUS_LABELS_RU, PaymentStatus } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney } from "@/lib/format";

const STATUS_STYLES: Record<PaymentStatus, string> = {
  [PaymentStatus.PAID]: "bg-emerald-50 text-emerald-700",
  [PaymentStatus.PARTIALLY_PAID]: "bg-amber-50 text-amber-700",
  [PaymentStatus.UNPAID]: "bg-red-50 text-red-700",
};

export function CustomerDetailModal({
  customerId,
  canRecordPayment,
  onClose,
  onChanged,
}: {
  customerId: string;
  canRecordPayment: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [customer, setCustomer] = useState<CustomerDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});
  const [busySaleId, setBusySaleId] = useState<string | null>(null);

  function load() {
    api.customers
      .findOne(customerId)
      .then(setCustomer)
      .catch(() => setError("Не удалось загрузить данные клиента"));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function handleRecordPayment(saleId: string, balanceDue: number) {
    const raw = paymentDrafts[saleId];
    const amount = Number(raw);
    if (!raw || !(amount > 0)) return;
    if (amount > balanceDue) {
      setError("Сумма оплаты превышает остаток задолженности");
      return;
    }
    setBusySaleId(saleId);
    setError(null);
    try {
      await api.sales.recordPayment(saleId, { amount });
      setPaymentDrafts((prev) => ({ ...prev, [saleId]: "" }));
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести оплату");
    } finally {
      setBusySaleId(null);
    }
  }

  return (
    <Modal title={customer?.name ?? "Клиент"} onClose={onClose} width="max-w-3xl">
      {!customer ? (
        <p className="py-8 text-center text-sm text-muted">Загрузка…</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <InfoCard label="Задолженность" value={formatMoney(customer.outstandingBalance)} highlight={customer.outstandingBalance > 0} />
            <InfoCard label="Кредитный лимит" value={customer.creditLimit !== null ? formatMoney(customer.creditLimit) : "—"} />
            <InfoCard label="Контакты" value={customer.phone ?? customer.email ?? "—"} />
          </div>

          {(customer.address || customer.notes) && (
            <div className="mb-5 space-y-1 rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted">
              {customer.address && <p>Адрес: {customer.address}</p>}
              {customer.notes && <p>{customer.notes}</p>}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <h3 className="mb-2 text-sm font-semibold text-foreground">История заказов</h3>
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">Дата</th>
                  <th className="px-4 py-2.5 font-medium">Точка</th>
                  <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                  <th className="px-4 py-2.5 text-right font-medium">Оплачено</th>
                  <th className="px-4 py-2.5 font-medium">Статус</th>
                  {canRecordPayment && <th className="px-4 py-2.5 font-medium">Оплата</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.orders.map((order) => (
                  <tr key={order.saleId}>
                    <td className="px-4 py-2.5 text-foreground">{formatDateTime(order.soldAt)}</td>
                    <td className="px-4 py-2.5 text-muted">{order.locationName}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">{formatMoney(order.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{formatMoney(order.amountPaid)}</td>
                    <td className="px-4 py-2.5">
                      <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_STYLES[order.paymentStatus])}>
                        {PAYMENT_STATUS_LABELS_RU[order.paymentStatus]}
                      </span>
                    </td>
                    {canRecordPayment && (
                      <td className="px-4 py-2.5">
                        {order.balanceDue > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              max={order.balanceDue}
                              step="any"
                              placeholder="Сумма"
                              value={paymentDrafts[order.saleId] ?? ""}
                              onChange={(e) =>
                                setPaymentDrafts((prev) => ({ ...prev, [order.saleId]: e.target.value }))
                              }
                              className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                            />
                            <button
                              onClick={() => handleRecordPayment(order.saleId, order.balanceDue)}
                              disabled={busySaleId === order.saleId}
                              className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
                            >
                              Внести
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {customer.orders.length === 0 && (
                  <tr>
                    <td colSpan={canRecordPayment ? 6 : 5} className="px-4 py-8 text-center text-sm text-muted">
                      Заказов пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

function InfoCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-muted px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx("mt-0.5 text-base font-semibold", highlight ? "text-red-600" : "text-foreground")}>
        {value}
      </p>
    </div>
  );
}
