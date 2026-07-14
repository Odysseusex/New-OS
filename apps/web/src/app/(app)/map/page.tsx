"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CustomerDto, LocationOverviewDto } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { CityMap } from "@/components/city-map";
import { formatMoney } from "@/lib/format";
import { customersToMapEntities, locationsToMapEntities, type MapEntity } from "@/lib/map-entities";

const KIND_LABELS_RU: Record<MapEntity["kind"], string> = {
  PRODUCTION: "Производство",
  WAREHOUSE: "Склад",
  STORE: "Точка продаж",
  CUSTOMER: "Клиент",
};

export default function MapPage() {
  const [locations, setLocations] = useState<LocationOverviewDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.locations.overview(), api.customers.list().catch(() => [])])
      .then(([locs, custs]) => {
        setLocations(locs);
        setCustomers(custs);
        setSelectedId((current) => current ?? locs[0]?.id ?? custs[0]?.id ?? null);
      })
      .catch(() => setError("Не удалось загрузить карту"));
  }, []);

  const entities: MapEntity[] = [
    ...locationsToMapEntities(locations),
    ...customersToMapEntities(customers),
  ];
  const selected = entities.find((e) => e.id === selectedId) ?? null;
  const withoutCoordsCount =
    locations.filter((l) => l.lat == null || l.lng == null).length +
    customers.filter((c) => c.lat == null || c.lng == null).length;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Карта</h1>
        <p className="mt-1 text-sm text-muted">Производство, склады, точки и клиенты на карте города</p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <CityMap entities={entities} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <LegendItem color="#b6702f" label="Производство" />
            <LegendItem color="#2563eb" label="Точка продаж" />
            <LegendItem color="#0d9488" label="Склад" />
            <LegendItem color="#7c3aed" label="Клиент" />
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
                !
              </span>
              Низкий остаток
            </span>
          </div>
          {withoutCoordsCount > 0 && (
            <p className="mt-3 text-xs text-muted">
              {withoutCoordsCount} объектов без координат не показаны на карте.
            </p>
          )}
        </div>

        <div className="h-fit rounded-2xl border border-border bg-surface p-5 shadow-card">
          {selected ? (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {KIND_LABELS_RU[selected.kind]}
              </p>
              <h2 className="mt-1 text-base font-semibold text-foreground">{selected.name}</h2>
              <p className="mt-1 text-sm text-muted">{selected.subtitle}</p>

              <div className="mt-5 space-y-3 border-t border-border pt-4">
                {selected.todayRevenue !== null && (
                  <MetricRow label="Выручка сегодня" value={formatMoney(selected.todayRevenue)} />
                )}
                {selected.lowStockCount !== null && (
                  <MetricRow
                    label="Товаров с низким остатком"
                    value={String(selected.lowStockCount)}
                    warn={selected.lowStockCount > 0}
                  />
                )}
                {selected.outstandingBalance !== null && (
                  <MetricRow
                    label="Задолженность"
                    value={formatMoney(selected.outstandingBalance)}
                    warn={selected.outstandingBalance > 0}
                  />
                )}
                {selected.todayRevenue === null &&
                  selected.lowStockCount === null &&
                  selected.outstandingBalance === null && (
                    <p className="text-sm text-muted">Нет доступа к показателям этого объекта</p>
                  )}
              </div>

              <div className="mt-5 flex gap-2 border-t border-border pt-4">
                {selected.kind === "CUSTOMER" ? (
                  <Link
                    href={selected.detailHref}
                    className="flex-1 rounded-xl border border-border px-3 py-2 text-center text-sm font-medium text-foreground transition hover:bg-surface-muted"
                  >
                    Клиенты
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/sales"
                      className="flex-1 rounded-xl border border-border px-3 py-2 text-center text-sm font-medium text-foreground transition hover:bg-surface-muted"
                    >
                      Продажи
                    </Link>
                    <Link
                      href="/inventory"
                      className="flex-1 rounded-xl border border-border px-3 py-2 text-center text-sm font-medium text-foreground transition hover:bg-surface-muted"
                    >
                      Склад
                    </Link>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Выберите объект на карте</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function MetricRow({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-semibold ${warn ? "text-amber-600" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
