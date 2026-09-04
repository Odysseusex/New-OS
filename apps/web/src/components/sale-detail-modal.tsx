"use client";

import { useEffect, useState } from "react";
import { CreditCard, Printer, Undo2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { SaleDetailDto, SaleFiscalReceiptDto, SaleReturnDto } from "@bakery-os/shared";
import { FiscalReceiptStatus, PAYMENT_METHOD_LABELS_RU, SALE_RETURN_ROLES } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { RecordSalePaymentModal } from "@/components/record-sale-payment-modal";
import { SaleReturnModal } from "@/components/sale-return-modal";

export function SaleDetailModal({
  saleId,
  canRecordPayment,
  onClose,
  onPaid,
}: {
  saleId: string;
  canRecordPayment: boolean;
  onClose: () => void;
  onPaid?: () => void;
}) {
  const { user } = useAuth();
  const [sale, setSale] = useState<SaleDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [returns, setReturns] = useState<SaleReturnDto[]>([]);
  const [isReturning, setIsReturning] = useState(false);
  const canReturn = user ? SALE_RETURN_ROLES.includes(user.role) : false;

  function load() {
    api.sales
      .findOne(saleId)
      .then(setSale)
      .catch(() => setError("Не удалось загрузить накладную"));
    api.sales.returns
      .list(saleId)
      .then(setReturns)
      .catch(() => {});
  }

  useEffect(() => {
    load();
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

            <div className="mb-5">
              <p className="mb-1.5 text-sm text-muted">Оплата</p>
              {/* `sale.payments ?? []`: guards against an API build that
                  predates this field returning a Sale with it simply
                  missing — see the same guard (and its full story) in the
                  till's PrintableReceipt. */}
              {(sale.payments ?? []).length > 0 ? (
                // A split sale: the parts, because «Смешанная» on its own
                // does not say how much went where.
                <div className="space-y-1">
                  {sale.payments.map((p) => (
                    <div key={p.method} className="flex justify-between text-sm">
                      <span className="text-foreground">{PAYMENT_METHOD_LABELS_RU[p.method]}</span>
                      <span className="font-medium text-foreground">{formatMoney(p.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-medium text-foreground">
                  {PAYMENT_METHOD_LABELS_RU[sale.paymentMethod]}
                </p>
              )}
            </div>

            {/* Only present once fiscalisation is on. Kept here rather than
                only on the till so a buyer coming back days later can still
                be shown the receipt their purchase was registered under. */}
            {sale.fiscalReceipt && <SaleFiscalReceipt fiscal={sale.fiscalReceipt} />}

            {returns.length > 0 && <SaleReturns returns={returns} />}

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

          <div className="mt-5 flex gap-3 print:hidden">
            {canRecordPayment && sale.balanceDue > 0 && (
              <button
                onClick={() => setIsPaying(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90"
              >
                <CreditCard className="h-4 w-4" strokeWidth={1.75} />
                Получить оплату
              </button>
            )}
            {canReturn && (
              <button
                onClick={() => setIsReturning(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Undo2 className="h-4 w-4" strokeWidth={1.75} />
                Возврат
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Печать накладной
            </button>
          </div>
        </>
      )}

      {isReturning && sale && (
        <SaleReturnModal
          sale={sale}
          previousReturns={returns}
          onClose={() => setIsReturning(false)}
          onReturned={() => {
            load();
            onPaid?.();
          }}
        />
      )}

      {isPaying && sale && (
        <RecordSalePaymentModal
          sale={{
            id: sale.id,
            customerName: sale.customerName,
            totalAmount: sale.totalAmount,
            amountPaid: sale.amountPaid,
            balanceDue: sale.balanceDue,
          }}
          onClose={() => setIsPaying(false)}
          onPaid={() => {
            load();
            onPaid?.();
          }}
        />
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

// The fiscal side of a recorded sale, shown on the накладная so the receipt
// number outlives the few seconds it is on the till screen. Renders nothing
// unless a receipt exists, which is every sale while fiscalisation is off.
function SaleFiscalReceipt({ fiscal }: { fiscal: SaleFiscalReceiptDto }) {
  const registered = fiscal.status === FiscalReceiptStatus.REGISTERED;

  return (
    <div className="mb-5 flex items-start gap-4 rounded-xl border border-border px-4 py-3">
      {fiscal.qrCode && (
        // Black-on-white on purpose: a QR has to survive a phone camera, so
        // it does not follow the theme tokens.
        <div className="shrink-0 rounded-lg bg-white p-2">
          <QRCodeSVG value={fiscal.qrCode} size={80} fgColor="#000000" bgColor="#ffffff" />
        </div>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-muted">Фискальный чек</p>
        {fiscal.ticketNumber ? (
          <p className="font-mono text-base font-semibold text-foreground">№ {fiscal.ticketNumber}</p>
        ) : (
          <p className="font-medium text-foreground">Номер не получен</p>
        )}
        {!registered && <p className="mt-1 text-amber-700">Чек не подтверждён кассой</p>}
        {registered && fiscal.isOffline && (
          <p className="mt-1 text-amber-700">Пробит офлайн — проверка по QR заработает после синхронизации</p>
        )}
      </div>
    </div>
  );
}

// Returns already made against this sale. Shown on the document itself so the
// накладная tells the whole story — what was sold and what came back.
function SaleReturns({ returns }: { returns: SaleReturnDto[] }) {
  const total = returns.reduce((sum, r) => sum + r.totalAmount, 0);

  return (
    <div className="mb-5 rounded-xl border border-border px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-foreground">Возвраты</span>
        <span className="font-semibold text-foreground">−{formatMoney(total)}</span>
      </div>
      <ul className="space-y-2 text-sm">
        {returns.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-muted">
              {formatDateTime(r.returnedAt)} ·{" "}
              {r.items.map((i) => `${i.productName} ${formatQuantity(i.quantity)}`).join(", ")}
              {!r.restocked && <span className="text-amber-700"> · списан</span>}
              {r.fiscalReceipt?.ticketNumber && (
                <span className="font-mono"> · чек № {r.fiscalReceipt.ticketNumber}</span>
              )}
            </span>
            <span className="text-foreground">−{formatMoney(r.totalAmount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
