"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Clock, LogIn, LogOut, Plus, XCircle } from "lucide-react";
import type { EmployeeDto, EmployeeKpiDto, LocationDto, ShiftDto, TimeEntryDto } from "@bakery-os/shared";
import {
  HR_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  ROLE_LABELS_RU,
  SHIFT_STATUS_LABELS_RU,
  ShiftStatus,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { NewShiftModal } from "@/components/new-shift-modal";

type Tab = "shifts" | "attendance" | "kpi";
type Period = "today" | "7d" | "30d" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Сегодня",
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

export default function HrPage() {
  const { user } = useAuth();
  const canManage = user ? HR_MANAGE_ROLES.includes(user.role) : false;
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("shifts");
  const [period, setPeriod] = useState<Period>("30d");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [shifts, setShifts] = useState<ShiftDto[]>([]);
  const [myShifts, setMyShifts] = useState<ShiftDto[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryDto[]>([]);
  const [myTimeEntries, setMyTimeEntries] = useState<TimeEntryDto[]>([]);
  const [kpi, setKpi] = useState<EmployeeKpiDto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClockBusy, setIsClockBusy] = useState(false);

  const loadMyStatus = useCallback(() => {
    api.hr.myShifts().then(setMyShifts).catch(() => {});
    api.hr.myTimeEntries().then(setMyTimeEntries).catch(() => {});
  }, []);

  const loadShifts = useCallback(() => {
    api.hr.shifts(locationFilter || undefined).then(setShifts).catch(() => setError("Не удалось загрузить смены"));
  }, [locationFilter]);

  const loadTimeEntries = useCallback(() => {
    api.hr
      .timeEntries(locationFilter || undefined)
      .then(setTimeEntries)
      .catch(() => setError("Не удалось загрузить табель"));
  }, [locationFilter]);

  const loadKpi = useCallback(() => {
    const { from, to } = periodRange(period);
    api.hr
      .kpi(from.toISOString(), to.toISOString(), locationFilter || undefined)
      .then((res) => setKpi(res.employees))
      .catch(() => setError("Не удалось загрузить KPI"));
  }, [period, locationFilter]);

  useEffect(() => {
    loadMyStatus();
  }, [loadMyStatus]);

  useEffect(() => {
    if (!canManage) return;
    api.locations.list().then(setLocations).catch(() => {});
    api.hr.employees(locationFilter || undefined).then(setEmployees).catch(() => {});
  }, [canManage, locationFilter]);

  useEffect(() => {
    if (canManage && tab === "shifts") loadShifts();
  }, [canManage, tab, loadShifts]);

  useEffect(() => {
    if (canManage && tab === "attendance") loadTimeEntries();
  }, [canManage, tab, loadTimeEntries]);

  useEffect(() => {
    if (canManage && tab === "kpi") loadKpi();
  }, [canManage, tab, loadKpi]);

  const openEntry = myTimeEntries.find((e) => e.clockOutAt === null) ?? null;
  const upcomingShifts = myShifts.filter((s) => s.status === ShiftStatus.SCHEDULED).slice(0, 5);

  async function handleClockIn() {
    setIsClockBusy(true);
    setError(null);
    try {
      await api.hr.clockIn({});
      loadMyStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отметить начало смены");
    } finally {
      setIsClockBusy(false);
    }
  }

  async function handleClockOut() {
    setIsClockBusy(true);
    setError(null);
    try {
      await api.hr.clockOut();
      loadMyStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось завершить смену");
    } finally {
      setIsClockBusy(false);
    }
  }

  async function handleCancelShift(shift: ShiftDto) {
    try {
      await api.hr.cancelShift(shift.id);
      loadShifts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить смену");
    }
  }

  const fixedLocationId = isOrgWide ? null : (user?.locationId ?? null);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Персонал</h1>
        <p className="mt-1 text-sm text-muted">Смены, учёт времени и показатели сотрудников</p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-foreground">Моя смена</h2>
          </div>
          {openEntry ? (
            <>
              <p className="mb-3 text-sm text-muted">
                Смена начата в {formatDateTime(openEntry.clockInAt)}
              </p>
              <button
                onClick={handleClockOut}
                disabled={isClockBusy}
                className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
                Завершить смену
              </button>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">Вы сейчас не отмечены на смене</p>
              <button
                onClick={handleClockIn}
                disabled={isClockBusy}
                className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" strokeWidth={1.75} />
                Начать смену
              </button>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Мои ближайшие смены</h2>
          {upcomingShifts.length === 0 ? (
            <p className="text-sm text-muted">Запланированных смен нет</p>
          ) : (
            <ul className="space-y-2">
              {upcomingShifts.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{s.locationName}</span>
                  <span className="text-muted">
                    {formatDateTime(s.startsAt)} — {formatDateTime(s.endsAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {canManage && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
              <TabButton active={tab === "shifts"} onClick={() => setTab("shifts")}>
                Смены
              </TabButton>
              <TabButton active={tab === "attendance"} onClick={() => setTab("attendance")}>
                Табель
              </TabButton>
              <TabButton active={tab === "kpi"} onClick={() => setTab("kpi")}>
                KPI
              </TabButton>
            </div>

            <div className="flex items-center gap-2">
              {tab === "kpi" && (
                <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                    <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                      {PERIOD_LABELS[p]}
                    </TabButton>
                  ))}
                </div>
              )}
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
              {tab === "shifts" && (
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.75} />
                  Новая смена
                </button>
              )}
            </div>
          </div>

          {tab === "shifts" && (
            <div className="rounded-2xl border border-border bg-surface shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Сотрудник</th>
                    {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                    <th className="px-5 py-3 font-medium">Начало</th>
                    <th className="px-5 py-3 font-medium">Конец</th>
                    <th className="px-5 py-3 font-medium">Статус</th>
                    <th className="px-5 py-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shifts.map((s) => (
                    <tr key={s.id}>
                      <td className="px-5 py-3 font-medium text-foreground">
                        {s.userFullName}
                        <span className="ml-1.5 text-xs font-normal text-muted">
                          {ROLE_LABELS_RU[s.userRole]}
                        </span>
                      </td>
                      {isOrgWide && <td className="px-5 py-3 text-muted">{s.locationName}</td>}
                      <td className="px-5 py-3 text-muted">{formatDateTime(s.startsAt)}</td>
                      <td className="px-5 py-3 text-muted">{formatDateTime(s.endsAt)}</td>
                      <td className="px-5 py-3">
                        <span
                          className={clsx(
                            "rounded-full px-2.5 py-1 text-xs font-medium",
                            s.status === ShiftStatus.SCHEDULED
                              ? "bg-amber-50 text-amber-700"
                              : "bg-surface-muted text-muted",
                          )}
                        >
                          {SHIFT_STATUS_LABELS_RU[s.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {s.status === ShiftStatus.SCHEDULED && (
                          <button
                            onClick={() => handleCancelShift(s)}
                            title="Отменить"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                          >
                            <XCircle className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {shifts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                        Смен пока нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "attendance" && (
            <div className="rounded-2xl border border-border bg-surface shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Сотрудник</th>
                    {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                    <th className="px-5 py-3 font-medium">Начало</th>
                    <th className="px-5 py-3 font-medium">Конец</th>
                    <th className="px-5 py-3 text-right font-medium">Часы</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {timeEntries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-5 py-3 font-medium text-foreground">{e.userFullName}</td>
                      {isOrgWide && <td className="px-5 py-3 text-muted">{e.locationName}</td>}
                      <td className="px-5 py-3 text-muted">{formatDateTime(e.clockInAt)}</td>
                      <td className="px-5 py-3 text-muted">
                        {e.clockOutAt ? formatDateTime(e.clockOutAt) : "ещё на смене"}
                      </td>
                      <td className="px-5 py-3 text-right text-foreground">
                        {e.hoursWorked !== null ? e.hoursWorked.toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                  {timeEntries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                        Записей табеля пока нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "kpi" && (
            <div className="rounded-2xl border border-border bg-surface shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">Сотрудник</th>
                    <th className="px-5 py-3 text-right font-medium">Продаж</th>
                    <th className="px-5 py-3 text-right font-medium">Выручка</th>
                    <th className="px-5 py-3 text-right font-medium">Партий произведено</th>
                    <th className="px-5 py-3 text-right font-medium">Единиц произведено</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {kpi.map((k) => (
                    <tr key={k.userId}>
                      <td className="px-5 py-3 font-medium text-foreground">
                        {k.userFullName}
                        <span className="ml-1.5 text-xs font-normal text-muted">
                          {ROLE_LABELS_RU[k.role]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-muted">{k.salesCount}</td>
                      <td className="px-5 py-3 text-right text-foreground">
                        {formatMoney(k.salesRevenue)}
                      </td>
                      <td className="px-5 py-3 text-right text-muted">{k.batchesCompleted}</td>
                      <td className="px-5 py-3 text-right text-muted">{k.unitsProduced}</td>
                    </tr>
                  ))}
                  {kpi.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                        Нет данных за выбранный период
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {isModalOpen && (
        <NewShiftModal
          employees={employees}
          locations={locations}
          fixedLocationId={fixedLocationId}
          onClose={() => setIsModalOpen(false)}
          onCreated={() => {
            setIsModalOpen(false);
            loadShifts();
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
        "rounded-lg px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
