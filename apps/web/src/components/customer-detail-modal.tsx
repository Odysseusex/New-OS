"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { CustomerDetailDto } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PaymentStatusBadge } from "@/components/payment-status-badge";
import { RecordSalePaymentModal, type SalePaymentContext } from "@/components/record-sale-payment-modal";

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
  const [payingSale, setPayingSale] = useState<SalePaymentContext | null>(null);

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
                  <th className="px-4 py-2.5 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.orders.map((order) => (
                  <tr key={order.saleId}>
                    <td className="px-4 py-2.5 text-foreground">{formatDateTime(order.soldAt)}</td>
                    <td className="px-4 py-2.5 text-muted">{order.locationName}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">{formatMoney(order.totalAmount)}</td>
                    <td className={clsx("px-4 py-2.5", canRecordPayment && order.balanceDue > 0 && "cursor-pointer")}>
                      <PaymentStatusBadge
                        status={order.paymentStatus}
                        amountPaid={order.amountPaid}
                        totalAmount={order.totalAmount}
                        onClick={
                          canRecordPayment && order.balanceDue > 0
                            ? () =>
                                setPayingSale({
                                  id: order.saleId,
                                  customerName: customer.name,
                                  totalAmount: order.totalAmount,
                                  amountPaid: order.amountPaid,
                                  balanceDue: order.balanceDue,
                                })
                            : undefined
                        }
                      />
                    </td>
                  </tr>
                ))}
                {customer.orders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                      Заказов пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {payingSale && (
        <RecordSalePaymentModal
          sale={payingSale}
          onClose={() => setPayingSale(null)}
          onPaid={() => {
            load();
            onChanged();
          }}
        />
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
