"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { SaleDetailDto } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";

export function SaleDetailModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { user } = useAuth();
  const [sale, setSale] = useState<SaleDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sales
      .findOne(saleId)
      .then(setSale)
      .catch(() => setError("Не удалось загрузить накладную"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  return (
    <Modal title="Накладная на отгрузку" onClose={onClose} width="max-w-2xl">
      {error && <p className="py-8 text-center text-sm text-red-600">{error}</p>}
      {!sale && !error && <p className="py-8 text-center text-sm text-muted">Загрузка…</p>}

      {sale && (
        <>
          <div id="sale-invoice-print" className="printable-invoice">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-base font-semibold text-foreground">
                  {user?.organization.name ?? "ArAmir OS"}
                </p>
                <p className="text-sm text-muted">Накладная на отгрузку №{sale.id.slice(-8).toUpperCase()}</p>
                <p className="text-sm text-muted">{formatDateTime(sale.soldAt)}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-muted">Отгружено с точки</p>
                <p className="font-medium text-foreground">{sale.locationName}</p>
              </div>
            </div>

            <div className="mb-5 rounded-xl bg-surface-muted px-4 py-3 text-sm">
              <p className="text-muted">Получатель</p>
              <p className="font-medium text-foreground">{sale.customerName ?? "Розничный покупатель"}</p>
            </div>

            <div className="mb-5 overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 font-medium">Товар</th>
                    <th className="px-4 py-2.5 text-right font-medium">Кол-во</th>
                    <th className="px-4 py-2.5 text-right font-medium">Цена</th>
                    <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sale.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 text-foreground">{item.productName}</td>
                      <td className="px-4 py-2.5 text-right text-muted">{formatQuantity(item.quantity)}</td>
                      <td className="px-4 py-2.5 text-right text-muted">{formatMoney(item.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-foreground">
                        {formatMoney(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-5 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted">Итого</p>
                <p className="text-base font-semibold text-foreground">{formatMoney(sale.totalAmount)}</p>
              </div>
              <div>
                <p className="text-muted">Оплачено</p>
                <p className="text-base font-semibold text-foreground">{formatMoney(sale.amountPaid)}</p>
              </div>
              <div>
                <p className="text-muted">Остаток долга</p>
                <p className={`text-base font-semibold ${sale.balanceDue > 0 ? "text-red-600" : "text-foreground"}`}>
                  {formatMoney(sale.balanceDue)}
                </p>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-2 gap-6 pt-6 text-sm text-muted">
              <div>
                <p className="mb-6">Сдал: {sale.createdByName}</p>
                <p className="border-t border-border pt-1">Подпись</p>
              </div>
              <div>
                <p className="mb-6">Принял: _______________________</p>
                <p className="border-t border-border pt-1">Подпись</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 print:hidden"
          >
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            Печать накладной
          </button>
        </>
      )}

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printable-invoice,
          .printable-invoice * {
            visibility: visible;
          }
          .printable-invoice {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </Modal>
  );
}
