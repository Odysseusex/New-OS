"use client";

import clsx from "clsx";
import { PAYMENT_STATUS_LABELS_RU, PaymentStatus } from "@bakery-os/shared";
import { formatMoney } from "@/lib/format";

const STATUS_STYLES: Record<PaymentStatus, string> = {
  [PaymentStatus.PAID]: "bg-emerald-50 text-emerald-700",
  [PaymentStatus.PARTIALLY_PAID]: "bg-amber-50 text-amber-700",
  [PaymentStatus.UNPAID]: "bg-red-50 text-red-700",
};

export function PaymentStatusBadge({
  status,
  amountPaid,
  totalAmount,
  onClick,
}: {
  status: PaymentStatus;
  amountPaid: number;
  totalAmount: number;
  // Omit when payment can't be recorded here (no permission, or already paid).
  onClick?: () => void;
}) {
  return (
    <div>
      <span
        onClick={
          onClick
            ? (e) => {
                e.stopPropagation();
                onClick();
              }
            : undefined
        }
        className={clsx(
          "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
          STATUS_STYLES[status],
          onClick && "cursor-pointer ring-1 ring-inset ring-transparent transition hover:ring-current",
        )}
        title={onClick ? "Получить оплату" : undefined}
      >
        {PAYMENT_STATUS_LABELS_RU[status]}
      </span>
      {status === PaymentStatus.PARTIALLY_PAID && (
        <p className="mt-1 text-xs text-muted">
          {formatMoney(amountPaid)} / {formatMoney(totalAmount)}
        </p>
      )}
    </div>
  );
}
