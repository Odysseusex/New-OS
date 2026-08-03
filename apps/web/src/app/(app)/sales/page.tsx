"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, Receipt, TrendingUp, Wallet } from "lucide-react";
import type { CustomerDto, LocationDto, ProductDto, SaleDto, SalesSummaryDto } from "@bakery-os/shared";
import { ORG_WIDE_ROLES, PAYMENT_STATUS_LABELS_RU, PaymentStatus, SALE_CREATE_ROLES } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { NewSaleModal } from "@/components/new-sale-modal";
import { SaleDetailModal } from "@/components/sale-detail-modal";

const STATUS_STYLES: Record<PaymentStatus, string> = {
  [PaymentStatus.PAID]: "bg-emerald-50 text-emerald-700",
  [PaymentStatus.PARTIALLY_PAID]: "bg-amber-50 text-amber-700",
  [PaymentStatus.UNPAID]: "bg-red-50 text-red-700",
};

export default function SalesPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const canCreateSale = user ? SALE_CREATE_ROLES.includes(user.role) : false;

  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [summary, setSummary] = useState<SalesSummaryDto | null>(null);
  const [sales, setSales] = useState<SaleDto[]>([]);
  const [locationFilter, setLocationFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.sales.summary(locationFilter || undefined), api.sales.list(locationFilter || undefined)])
      .then(([s, list]) => {
        setSummary(s);
        setSales(list);
      })
      .catch(() => setError("Не удалось загрузить продажи"));
  }, [locationFilter]);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
    api.products.list().then(setProducts).catch(() => {});
    if (canCreateSale) {
      api.customers.list().then(setCustomers).catch(() => {});
    }
  }, [canCreateSale]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Продажи</h1>
          <p className="mt-1 text-sm text-muted">Выручка и транзакции по сети</p>
        </div>
        <div className="flex items-center gap-3">
          {isOrgWide && (
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Вся сеть</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}
          {canCreateSale && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новая продажа
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Wallet} label="Выручка сегодня" value={formatMoney(summary?.todayRevenue ?? 0)} />
        <StatCard icon={TrendingUp} label="Выручка за 7 дней" value={formatMoney(summary?.last7DaysRevenue ?? 0)} />
        <StatCard icon={Receipt} label="Средний чек" value={formatMoney(summary?.averageTicket ?? 0)} />
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Последние продажи</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Время</th>
              {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
              <th className="px-5 py-3 font-medium">Клиент</th>
              <th className="px-5 py-3 font-medium">Товаров</th>
              <th className="px-5 py-3 font-medium">Кассир</th>
              <th className="px-5 py-3 text-right font-medium">Сумма</th>
              <th className="px-5 py-3 font-medium">Оплата</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sales.map((sale) => (
              <tr
                key={sale.id}
                onClick={() => setSelectedSaleId(sale.id)}
                className="cursor-pointer transition hover:bg-surface-muted"
              >
                <td className="px-5 py-3 text-foreground">{formatDateTime(sale.soldAt)}</td>
                {isOrgWide && <td className="px-5 py-3 text-muted">{sale.locationName}</td>}
                <td className="px-5 py-3 text-muted">{sale.customerName ?? "Розница"}</td>
                <td className="px-5 py-3 text-muted">{sale.itemsCount}</td>
                <td className="px-5 py-3 text-muted">{sale.createdByName}</td>
                <td className="px-5 py-3 text-right font-medium text-foreground">
                  {formatMoney(sale.totalAmount)}
                </td>
                <td className="px-5 py-3">
                  <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_STYLES[sale.paymentStatus])}>
                    {PAYMENT_STATUS_LABELS_RU[sale.paymentStatus]}
                  </span>
                </td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                  Продаж пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <NewSaleModal
          locations={locations}
          products={products}
          customers={customers}
          fixedLocationId={isOrgWide ? null : (user?.locationId ?? null)}
          onClose={() => setIsModalOpen(false)}
          onCreated={() => {
            setIsModalOpen(false);
            load();
          }}
        />
      )}

      {selectedSaleId && (
        <SaleDetailModal saleId={selectedSaleId} onClose={() => setSelectedSaleId(null)} />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-accent">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </div>
  );
}
