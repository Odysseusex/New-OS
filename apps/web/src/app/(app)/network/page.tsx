"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus } from "lucide-react";
import type { LocationComparisonDto, LocationDto, RegionDto } from "@bakery-os/shared";
import {
  LOCATION_MANAGE_ROLES,
  LOCATION_OWNERSHIP_LABELS_RU,
  LOCATION_TYPE_LABELS_RU,
  LocationOwnership,
  NETWORK_VIEW_ROLES,
} from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/format";
import { NewLocationModal } from "@/components/new-location-modal";

type Tab = "registry" | "comparison";
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

const OWNERSHIP_STYLES: Record<LocationOwnership, string> = {
  [LocationOwnership.OWNED]: "bg-surface-muted text-muted",
  [LocationOwnership.FRANCHISE]: "bg-amber-50 text-amber-700",
};

export default function NetworkPage() {
  const { user } = useAuth();
  const canManage = user ? LOCATION_MANAGE_ROLES.includes(user.role) : false;
  const canViewComparison = user ? NETWORK_VIEW_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("registry");
  const [period, setPeriod] = useState<Period>("30d");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [comparison, setComparison] = useState<LocationComparisonDto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRegistry = useCallback(() => {
    api.locations.list().then(setLocations).catch(() => setError("Не удалось загрузить точки"));
  }, []);

  const loadComparison = useCallback(() => {
    const { from, to } = periodRange(period);
    api.locations
      .comparison(from.toISOString(), to.toISOString())
      .then(setComparison)
      .catch(() => setError("Не удалось загрузить сравнение точек"));
  }, [period]);

  useEffect(() => {
    loadRegistry();
    api.locations.regions().then(setRegions).catch(() => {});
  }, [loadRegistry]);

  useEffect(() => {
    if (tab === "comparison" && canViewComparison) loadComparison();
  }, [tab, canViewComparison, loadComparison]);

  const regionName = (regionId: string | null) => regions.find((r) => r.id === regionId)?.name ?? "—";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Сеть точек</h1>
          <p className="mt-1 text-sm text-muted">Реестр точек, франшиза и сравнение локаций</p>
        </div>
        {canManage && tab === "registry" && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Новая точка
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {canViewComparison && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
            <TabButton active={tab === "registry"} onClick={() => setTab("registry")}>
              Реестр
            </TabButton>
            <TabButton active={tab === "comparison"} onClick={() => setTab("comparison")}>
              Сравнение
            </TabButton>
          </div>

          {tab === "comparison" && (
            <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                  {PERIOD_LABELS[p]}
                </TabButton>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "registry" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 font-medium">Форма</th>
                <th className="px-5 py-3 font-medium">Регион</th>
                <th className="px-5 py-3 font-medium">Адрес</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {locations.map((loc) => (
                <tr key={loc.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{loc.name}</td>
                  <td className="px-5 py-3 text-muted">{LOCATION_TYPE_LABELS_RU[loc.type]}</td>
                  <td className="px-5 py-3">
                    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", OWNERSHIP_STYLES[loc.ownership])}>
                      {LOCATION_OWNERSHIP_LABELS_RU[loc.ownership]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted">{regionName(loc.regionId)}</td>
                  <td className="px-5 py-3 text-muted">
                    {loc.city}, {loc.address}
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                    Точек пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "comparison" && canViewComparison && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Точка</th>
                <th className="px-5 py-3 text-right font-medium">Выручка</th>
                <th className="px-5 py-3 text-right font-medium">Продаж</th>
                <th className="px-5 py-3 text-right font-medium">Средний чек</th>
                <th className="px-5 py-3 text-right font-medium">Низкий остаток</th>
                <th className="px-5 py-3 text-right font-medium">Сотрудников</th>
                <th className="px-5 py-3 text-right font-medium">Расходы</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparison.map((loc) => (
                <tr key={loc.id}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    {loc.name}
                    <span className="ml-1.5 text-xs font-normal text-muted">
                      {LOCATION_OWNERSHIP_LABELS_RU[loc.ownership]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-foreground">{formatMoney(loc.revenue)}</td>
                  <td className="px-5 py-3 text-right text-muted">{loc.salesCount}</td>
                  <td className="px-5 py-3 text-right text-muted">{formatMoney(loc.averageTicket)}</td>
                  <td className="px-5 py-3 text-right text-muted">
                    {loc.lowStockCount > 0 ? (
                      <span className="text-amber-700">{loc.lowStockCount}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-muted">{loc.activeStaffCount}</td>
                  <td className="px-5 py-3 text-right text-muted">{formatMoney(loc.expenses)}</td>
                </tr>
              ))}
              {comparison.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    Нет данных за выбранный период
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <NewLocationModal
          regions={regions}
          onClose={() => setIsModalOpen(false)}
          onCreated={() => {
            setIsModalOpen(false);
            loadRegistry();
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
