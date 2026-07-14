"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { LocationDto, ProductDto, QualitySummaryDto, StockMovementDto } from "@bakery-os/shared";
import {
  INVENTORY_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  QUALITY_VIEW_ROLES,
  WRITE_OFF_REASON_LABELS_RU,
} from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { StockMovementModal } from "@/components/stock-movement-modal";

type Period = "7d" | "30d" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
};

function periodRange(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (period === "7d") from.setDate(from.getDate() - 6);
  if (period === "30d") from.setDate(from.getDate() - 29);
  if (period === "month") from.setDate(1);
  return { from, to };
}

export default function QualityPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const canView = user ? QUALITY_VIEW_ROLES.includes(user.role) : false;
  const canManage = user ? INVENTORY_MANAGE_ROLES.includes(user.role) : false;

  const [period, setPeriod] = useState<Period>("30d");
  const [locationFilter, setLocationFilter] = useState("");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [summary, setSummary] = useState<QualitySummaryDto | null>(null);
  const [writeOffs, setWriteOffs] = useState<StockMovementDto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canView) return;
    const { from, to } = periodRange(period);
    Promise.all([
      api.quality.summary(from.toISOString(), to.toISOString(), locationFilter || undefined),
      api.quality.writeOffs(locationFilter || undefined, from.toISOString(), to.toISOString()),
    ])
      .then(([s, list]) => {
        setSummary(s);
        setWriteOffs(list);
      })
      .catch(() => setError("Не удалось загрузить данные по списаниям"));
  }, [canView, period, locationFilter]);

  useEffect(() => {
    if (!canView) return;
    api.locations.list().then(setLocations).catch(() => {});
    api.products.list().then(setProducts).catch(() => {});
  }, [canView]);

  useEffect(() => {
    load();
  }, [load]);

  const fixedLocationId = isOrgWide ? null : (user?.locationId ?? null);

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <AlertTriangle className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} />
        <h1 className="text-lg font-semibold text-foreground">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted">
          Раздел «Качество и списания» доступен владельцу, администратору и управляющим.
        </p>
      </div>
    );
  }

  const topReason = summary?.byReason[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Качество и списания</h1>
          <p className="mt-1 text-sm text-muted">Учёт брака и потерь по причинам</p>
        </div>
        {canManage && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            Списать товар
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
                period === p ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

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
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Списано на сумму" value={formatMoney(summary?.totalValue ?? 0)} />
        <StatCard label="Случаев списания" value={String(summary?.totalMovements ?? 0)} />
        <StatCard
          label="Основная причина"
          value={topReason ? WRITE_OFF_REASON_LABELS_RU[topReason.reason] : "—"}
        />
      </div>

      <div className="mb-8 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-semibold text-foreground">По причинам</h2>
        <div className="space-y-3">
          {(summary?.byReason.length ?? 0) === 0 && (
            <p className="py-4 text-center text-sm text-muted">За период списаний не было</p>
          )}
          {summary?.byReason.map((entry) => {
            const pct = summary.totalValue > 0 ? (entry.value / summary.totalValue) * 100 : 0;
            return (
              <div key={entry.reason}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-foreground">{WRITE_OFF_REASON_LABELS_RU[entry.reason]}</span>
                  <span className="text-muted">
                    {formatMoney(entry.value)} · {formatQuantity(entry.quantity)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Списания за период</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Дата</th>
              <th className="px-5 py-3 font-medium">Товар</th>
              {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
              <th className="px-5 py-3 font-medium">Причина</th>
              <th className="px-5 py-3 font-medium">Комментарий</th>
              <th className="px-5 py-3 text-right font-medium">Кол-во</th>
              <th className="px-5 py-3 font-medium">Кто</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {writeOffs.map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-3 text-muted">{formatDateTime(m.createdAt)}</td>
                <td className="px-5 py-3 font-medium text-foreground">{m.productName}</td>
                {isOrgWide && <td className="px-5 py-3 text-muted">{m.locationName}</td>}
                <td className="px-5 py-3">
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    {m.writeOffReason ? WRITE_OFF_REASON_LABELS_RU[m.writeOffReason] : "—"}
                  </span>
                </td>
                <td className="px-5 py-3 text-muted">{m.reason ?? "—"}</td>
                <td className="px-5 py-3 text-right font-medium text-foreground">
                  {formatQuantity(m.quantity)}
                </td>
                <td className="px-5 py-3 text-muted">{m.createdByName}</td>
              </tr>
            ))}
            {writeOffs.length === 0 && (
              <tr>
                <td colSpan={isOrgWide ? 7 : 6} className="px-5 py-8 text-center text-sm text-muted">
                  Списаний за период нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <StockMovementModal
          mode="write-off"
          locations={locations}
          products={products}
          fixedLocationId={fixedLocationId}
          onClose={() => setIsModalOpen(false)}
          onCreated={() => {
            setIsModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </div>
  );
}
