"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { ProductDayTrailDto } from "@bakery-os/shared";
import { PAYMENT_METHOD_LABELS_RU, STOCK_MOVEMENT_TYPE_LABELS_RU, UNIT_LABELS_RU } from "@bakery-os/shared";
import { Modal } from "@/components/modal";
import { api, ApiError } from "@/lib/api";
import { formatMoney, formatQuantity } from "@/lib/format";
import { REPORTING_TIME_ZONE } from "@/lib/reporting-period";

const timeFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: REPORTING_TIME_ZONE, hour: "2-digit", minute: "2-digit" });

// One product's day at one location, step by step, with what was left after each step.
export function ProductTrailModal({
  locationId,
  date,
  productId,
  productName,
  onClose,
}: {
  locationId: string;
  date: string;
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const [trail, setTrail] = useState<ProductDayTrailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.reconciliation
      .productTrail(locationId, date, productId)
      .then((data) => {
        if (!cancelled) setTrail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Не удалось загрузить движение товара");
      });
    return () => {
      cancelled = true;
    };
  }, [locationId, date, productId]);

  const unit = trail ? UNIT_LABELS_RU[trail.unit] : "";
  return (
    <Modal title={`${productName} — ${date.split("-").reverse().join(".")}`} onClose={onClose} width="max-w-3xl">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!error && !trail && <p className="py-6 text-center text-sm text-muted">Загрузка…</p>}
      {trail && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium">Время</th>
              <th className="py-2 pr-3 font-medium">Что</th>
              <th className="py-2 pr-3 text-right font-medium">Кол-во</th>
              <th className="py-2 pr-3 text-right font-medium">Остаток</th>
              <th className="py-2 pr-3 font-medium">Кто</th>
              <th className="py-2 text-right font-medium">Чек</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr>
              <td className="py-2 pr-3 text-muted">—</td>
              <td className="py-2 pr-3 text-muted">На начало дня</td>
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 text-right font-medium text-foreground">
                {formatQuantity(trail.opening)} {unit}
              </td>
              <td className="py-2 pr-3" />
              <td className="py-2" />
            </tr>
            {trail.rows.map((row, i) => (
              <tr key={i}>
                <td className="py-2 pr-3 text-foreground">{timeFormat.format(new Date(row.at))}</td>
                <td className="py-2 pr-3 text-foreground">
                  {STOCK_MOVEMENT_TYPE_LABELS_RU[row.type]}
                  {row.reason && !row.sale && <span className="block text-xs text-muted">{row.reason}</span>}
                </td>
                <td className={clsx("py-2 pr-3 text-right font-medium", row.change < 0 ? "text-red-600" : "text-green-600")}>
                  {row.change > 0 ? "+" : ""}
                  {formatQuantity(row.change)}
                </td>
                <td className={clsx("py-2 pr-3 text-right", row.balance < 0 ? "font-medium text-red-600" : "text-foreground")}>
                  {formatQuantity(row.balance)}
                </td>
                <td className="py-2 pr-3 text-muted">{row.byName}</td>
                <td className="py-2 text-right text-muted">
                  {row.sale ? `${formatMoney(row.sale.total)} · ${PAYMENT_METHOD_LABELS_RU[row.sale.paymentMethod]}` : ""}
                </td>
              </tr>
            ))}
            {trail.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  За этот день движений не было
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
