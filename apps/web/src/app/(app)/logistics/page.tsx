"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Plus, ShieldAlert, XCircle } from "lucide-react";
import type { DeliveryRouteDto, DriverDto, LocationDto, ProductDto, VehicleDto } from "@bakery-os/shared";
import {
  DELIVERY_ROUTE_STATUS_LABELS_RU,
  DeliveryRouteStatus,
  LOGISTICS_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  ROUTE_EXECUTE_ROLES,
  ROUTE_STOP_STATUS_LABELS_RU,
  RouteStopStatus,
  UNIT_LABELS_RU,
  VEHICLE_STATUS_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { NewRouteModal } from "@/components/new-route-modal";
import { NewVehicleModal } from "@/components/new-vehicle-modal";

type Tab = "routes" | "vehicles";

export default function LogisticsPage() {
  const { user } = useAuth();
  const canView = user ? ROUTE_EXECUTE_ROLES.includes(user.role) : false;
  const canManage = user ? LOGISTICS_MANAGE_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("routes");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [vehicles, setVehicles] = useState<VehicleDto[]>([]);
  const [drivers, setDrivers] = useState<DriverDto[]>([]);
  const [routes, setRoutes] = useState<DeliveryRouteDto[]>([]);
  const [modal, setModal] = useState<"route" | "vehicle" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRoutes = useCallback(() => {
    api.logistics.routes().then(setRoutes).catch(() => setError("Не удалось загрузить маршруты"));
  }, []);

  const loadVehicles = useCallback(() => {
    api.vehicles.list().then(setVehicles).catch(() => setError("Не удалось загрузить транспорт"));
  }, []);

  useEffect(() => {
    if (!canView) return;
    api.locations.list().then(setLocations).catch(() => {});
    api.products.list().then(setProducts).catch(() => {});
    loadVehicles();
    if (canManage) {
      api.logistics.drivers().then(setDrivers).catch(() => {});
    }
  }, [canView, canManage, loadVehicles]);

  useEffect(() => {
    if (canView) loadRoutes();
  }, [canView, loadRoutes]);

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} />
        <h1 className="text-lg font-semibold text-foreground">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted">
          Логистика доступна владельцу, администратору, кладовщику и водителям.
        </p>
      </div>
    );
  }

  const originLocations = locations.filter(
    (l) => l.type === "BAKERY_PRODUCTION" || l.type === "WAREHOUSE",
  );
  const destinationLocations = locations.filter((l) => l.type === "STORE");
  const fixedOriginLocationId =
    user && !ORG_WIDE_ROLES.includes(user.role) ? (user.locationId ?? null) : null;

  async function handleDeliver(route: DeliveryRouteDto, stopId: string) {
    try {
      await api.logistics.deliverStop(route.id, stopId);
      loadRoutes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отметить доставку");
    }
  }

  async function handleCancelRoute(route: DeliveryRouteDto) {
    try {
      await api.logistics.cancelRoute(route.id);
      loadRoutes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить маршрут");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Логистика</h1>
          <p className="mt-1 text-sm text-muted">Маршруты доставки и транспорт</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <TabButton active={tab === "routes"} onClick={() => setTab("routes")}>
            Маршруты
          </TabButton>
          <TabButton active={tab === "vehicles"} onClick={() => setTab("vehicles")}>
            Транспорт
          </TabButton>
        </div>

        {tab === "routes" && canManage && (
          <button
            onClick={() => setModal("route")}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Новый маршрут
          </button>
        )}

        {tab === "vehicles" && canManage && (
          <button
            onClick={() => setModal("vehicle")}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Новый транспорт
          </button>
        )}
      </div>

      {tab === "routes" && (
        <div className="space-y-4">
          {routes.map((route) => (
            <div key={route.id} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {route.originLocationName} → {route.stops.length}{" "}
                    {route.stops.length === 1 ? "остановка" : "остановки"}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateTime(route.scheduledFor)}
                    {route.vehicleName ? ` · ${route.vehicleName}` : ""}
                    {route.driverName ? ` · ${route.driverName}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <RouteStatusBadge status={route.status} />
                  {canManage && route.status === DeliveryRouteStatus.PLANNED && (
                    <button
                      onClick={() => handleCancelRoute(route)}
                      title="Отменить маршрут"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                    >
                      <XCircle className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>

              <ul className="space-y-2">
                {route.stops.map((stop) => (
                  <li
                    key={stop.id}
                    className="flex items-center justify-between rounded-xl bg-surface-muted px-3.5 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {stop.sequence}. {stop.destinationLocationName}
                      </p>
                      <p className="text-xs text-muted">
                        {stop.items
                          .map((item) => `${item.productName} — ${formatQuantity(item.quantity)} ${UNIT_LABELS_RU[item.unit]}`)
                          .join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StopStatusBadge status={stop.status} />
                      {stop.status === RouteStopStatus.PENDING &&
                        route.status !== DeliveryRouteStatus.CANCELLED && (
                          <button
                            onClick={() => handleDeliver(route, stop.id)}
                            title="Отметить доставленным"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-green-600"
                          >
                            <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {routes.length === 0 && (
            <p className="py-12 text-center text-sm text-muted">Маршрутов пока нет</p>
          )}
        </div>
      )}

      {tab === "vehicles" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Гос. номер</th>
                <th className="px-5 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{v.name}</td>
                  <td className="px-5 py-3 text-muted">{v.plateNumber}</td>
                  <td className="px-5 py-3 text-muted">{VEHICLE_STATUS_LABELS_RU[v.status]}</td>
                </tr>
              ))}
              {vehicles.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm text-muted">
                    Транспорта пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal === "route" && (
        <NewRouteModal
          originLocations={originLocations}
          destinationLocations={destinationLocations}
          vehicles={vehicles}
          drivers={drivers}
          products={products}
          fixedOriginLocationId={fixedOriginLocationId}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            loadRoutes();
          }}
        />
      )}

      {modal === "vehicle" && (
        <NewVehicleModal
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            loadVehicles();
          }}
        />
      )}
    </div>
  );
}

function RouteStatusBadge({ status }: { status: DeliveryRouteStatus }) {
  const styles: Record<DeliveryRouteStatus, string> = {
    [DeliveryRouteStatus.PLANNED]: "bg-amber-50 text-amber-700",
    [DeliveryRouteStatus.IN_PROGRESS]: "bg-blue-50 text-blue-700",
    [DeliveryRouteStatus.COMPLETED]: "bg-green-50 text-green-700",
    [DeliveryRouteStatus.CANCELLED]: "bg-surface-muted text-muted",
  };
  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", styles[status])}>
      {DELIVERY_ROUTE_STATUS_LABELS_RU[status]}
    </span>
  );
}

function StopStatusBadge({ status }: { status: RouteStopStatus }) {
  return (
    <span
      className={clsx(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        status === RouteStopStatus.DELIVERED ? "bg-green-50 text-green-700" : "bg-surface text-muted",
      )}
    >
      {ROUTE_STOP_STATUS_LABELS_RU[status]}
    </span>
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
