"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Clock, LogIn, LogOut, Plus, Wallet, XCircle } from "lucide-react";
import type {
  EmployeeDto,
  EmployeeKpiDto,
  LocationDto,
  ShiftDto,
  TimeEntryDto,
  UserAccountDto,
} from "@bakery-os/shared";
import {
  EMPLOYEE_MANAGE_ROLES,
  HARD_DELETE_ROLES,
  HR_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  ROLE_LABELS_RU,
  SALARY_VIEW_ROLES,
  SHIFT_STATUS_LABELS_RU,
  ShiftStatus,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { NewShiftModal } from "@/components/new-shift-modal";
import { EmployeeModal } from "@/components/employee-modal";
import { EmployeeCompensationModal } from "@/components/employee-compensation-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

type Tab = "employees" | "shifts" | "attendance" | "kpi";
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
  const canManageEmployees = user ? EMPLOYEE_MANAGE_ROLES.includes(user.role) : false;
  const canDeleteEmployees = user ? HARD_DELETE_ROLES.includes(user.role) : false;
  const canViewSalary = user ? SALARY_VIEW_ROLES.includes(user.role) : false;
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("employees");
  const [period, setPeriod] = useState<Period>("30d");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);
  const [showArchivedEmployees, setShowArchivedEmployees] = useState(false);
  const [linkableUsers, setLinkableUsers] = useState<UserAccountDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [shifts, setShifts] = useState<ShiftDto[]>([]);
  const [myShifts, setMyShifts] = useState<ShiftDto[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryDto[]>([]);
  const [myTimeEntries, setMyTimeEntries] = useState<TimeEntryDto[]>([]);
  const [kpi, setKpi] = useState<EmployeeKpiDto[]>([]);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeDto | undefined>(undefined);
  const [compensationEmployee, setCompensationEmployee] = useState<EmployeeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClockBusy, setIsClockBusy] = useState(false);
  const [isManagerClockBusy, setIsManagerClockBusy] = useState<string | null>(null);

  const loadMyStatus = useCallback(() => {
    api.hr.myShifts().then(setMyShifts).catch(() => {});
    api.hr.myTimeEntries().then(setMyTimeEntries).catch(() => {});
  }, []);

  const loadEmployees = useCallback(() => {
    if (!canManageEmployees) return;
    api.hr.employees
      .list(locationFilter || undefined, showArchivedEmployees)
      .then(setEmployees)
      .catch(() => setError("Не удалось загрузить сотрудников"));
  }, [canManageEmployees, locationFilter, showArchivedEmployees]);

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
  }, [canManage]);

  useEffect(() => {
    if (!canManageEmployees) return;
    api.users.list().then(setLinkableUsers).catch(() => {});
  }, [canManageEmployees]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

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
  // Employees with no ERP login can't self-clock — a manager marks their
  // attendance instead (see HrService.clockInFor/clockOutFor).
  const loginlessEmployees = employees.filter((e) => !e.userId && e.isActive);
  const usersAlreadyLinked = new Set(employees.filter((e) => e.userId).map((e) => e.userId));
  const availableUsersToLink = linkableUsers.filter((u) => !usersAlreadyLinked.has(u.id));

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

  async function handleArchiveEmployee(employee: EmployeeDto) {
    try {
      await api.hr.employees.archive(employee.id);
      loadEmployees();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось деактивировать сотрудника");
    }
  }

  async function handleRestoreEmployee(employee: EmployeeDto) {
    try {
      await api.hr.employees.restore(employee.id);
      loadEmployees();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось восстановить сотрудника");
    }
  }

  async function handleDeleteEmployee(employee: EmployeeDto) {
    if (!confirm(`Удалить сотрудника «${employee.fullName}»? Это действие необратимо.`)) return;
    try {
      await api.hr.employees.remove(employee.id);
      loadEmployees();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось удалить сотрудника");
    }
  }

  async function handleManagerClockToggle(employee: EmployeeDto) {
    const employeeOpenEntry = timeEntries.find((e) => e.employeeId === employee.id && e.clockOutAt === null);
    setIsManagerClockBusy(employee.id);
    setError(null);
    try {
      if (employeeOpenEntry) {
        await api.hr.employees.clockOut(employee.id);
      } else {
        await api.hr.employees.clockIn(employee.id, {});
      }
      loadTimeEntries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отметить смену сотрудника");
    } finally {
      setIsManagerClockBusy(null);
    }
  }

  const fixedLocationId = isOrgWide ? null : (user?.locationId ?? null);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Персонал</h1>
        <p className="mt-1 text-sm text-muted">Сотрудники, смены, учёт времени и показатели</p>
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

      {(canManage || canManageEmployees) && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
              {canManageEmployees && (
                <TabButton active={tab === "employees"} onClick={() => setTab("employees")}>
                  Сотрудники
                </TabButton>
              )}
              {canManage && (
                <>
                  <TabButton active={tab === "shifts"} onClick={() => setTab("shifts")}>
                    Смены
                  </TabButton>
                  <TabButton active={tab === "attendance"} onClick={() => setTab("attendance")}>
                    Табель
                  </TabButton>
                  <TabButton active={tab === "kpi"} onClick={() => setTab("kpi")}>
                    KPI
                  </TabButton>
                </>
              )}
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
              {tab === "employees" && <ArchivedToggle checked={showArchivedEmployees} onChange={setShowArchivedEmployees} />}
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
              {tab === "employees" && (
                <button
                  onClick={() => {
                    setEditingEmployee(undefined);
                    setIsEmployeeModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.75} />
                  Новый сотрудник
                </button>
              )}
              {tab === "shifts" && (
                <button
                  onClick={() => setIsShiftModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.75} />
                  Новая смена
                </button>
              )}
            </div>
          </div>

          {tab === "employees" && (
            <div className="rounded-2xl border border-border bg-surface shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-medium">ФИО</th>
                    <th className="px-5 py-3 font-medium">Должность</th>
                    {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                    <th className="px-5 py-3 font-medium">Доступ к системе</th>
                    {canViewSalary && <th className="px-5 py-3 font-medium">Ставка</th>}
                    <th className="px-5 py-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employees.map((emp) => (
                    <tr key={emp.id} className={clsx(!emp.isActive && "opacity-60")}>
                      <td className="px-5 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {emp.fullName}
                          {!emp.isActive && <ArchivedBadge />}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted">{emp.position}</td>
                      {isOrgWide && <td className="px-5 py-3 text-muted">{emp.locationName ?? "—"}</td>}
                      <td className="px-5 py-3 text-muted">
                        {emp.userId ? (
                          <span className="text-foreground">
                            {emp.userEmail}
                            {emp.userRole && (
                              <span className="ml-1.5 text-xs text-muted">({ROLE_LABELS_RU[emp.userRole]})</span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {canViewSalary && (
                        <td className="px-5 py-3">
                          <button
                            onClick={() => setCompensationEmployee(emp)}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:bg-surface-muted hover:text-foreground"
                          >
                            <Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />
                            Ставка
                          </button>
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <RowActions
                          isActive={emp.isActive}
                          onEdit={() => {
                            setEditingEmployee(emp);
                            setIsEmployeeModalOpen(true);
                          }}
                          onArchive={() => handleArchiveEmployee(emp)}
                          onRestore={() => handleRestoreEmployee(emp)}
                          onDelete={canDeleteEmployees ? () => handleDeleteEmployee(emp) : undefined}
                        />
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={canViewSalary ? 6 : 5} className="px-5 py-8 text-center text-sm text-muted">
                        Сотрудников пока нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

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
                        {s.employeeFullName}
                        <span className="ml-1.5 text-xs font-normal text-muted">{s.employeePosition}</span>
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
            <>
              {loginlessEmployees.length > 0 && (
                <div className="mb-4 rounded-2xl border border-border bg-surface p-4 shadow-card">
                  <h3 className="mb-3 text-sm font-semibold text-foreground">
                    Отметить вручную — сотрудники без входа в систему
                  </h3>
                  <ul className="space-y-2">
                    {loginlessEmployees.map((emp) => {
                      const employeeOpenEntry = timeEntries.find(
                        (e) => e.employeeId === emp.id && e.clockOutAt === null,
                      );
                      return (
                        <li key={emp.id} className="flex items-center justify-between text-sm">
                          <span className="text-foreground">
                            {emp.fullName} <span className="text-xs text-muted">{emp.position}</span>
                          </span>
                          <button
                            onClick={() => handleManagerClockToggle(emp)}
                            disabled={isManagerClockBusy === emp.id}
                            className={clsx(
                              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-60",
                              employeeOpenEntry
                                ? "bg-surface-muted text-foreground hover:opacity-80"
                                : "bg-accent text-accent-foreground hover:opacity-90",
                            )}
                          >
                            {employeeOpenEntry ? (
                              <>
                                <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
                                Завершить смену
                              </>
                            ) : (
                              <>
                                <LogIn className="h-3.5 w-3.5" strokeWidth={1.75} />
                                Начать смену
                              </>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-surface shadow-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-medium">Сотрудник</th>
                      {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                      <th className="px-5 py-3 font-medium">Начало</th>
                      <th className="px-5 py-3 font-medium">Конец</th>
                      <th className="px-5 py-3 text-right font-medium">Часы</th>
                      <th className="px-5 py-3 font-medium">Отметил</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {timeEntries.map((e) => (
                      <tr key={e.id}>
                        <td className="px-5 py-3 font-medium text-foreground">{e.employeeFullName}</td>
                        {isOrgWide && <td className="px-5 py-3 text-muted">{e.locationName}</td>}
                        <td className="px-5 py-3 text-muted">{formatDateTime(e.clockInAt)}</td>
                        <td className="px-5 py-3 text-muted">
                          {e.clockOutAt ? formatDateTime(e.clockOutAt) : "ещё на смене"}
                        </td>
                        <td className="px-5 py-3 text-right text-foreground">
                          {e.hoursWorked !== null ? e.hoursWorked.toFixed(1) : "—"}
                        </td>
                        <td className="px-5 py-3 text-muted">{e.recordedByName}</td>
                      </tr>
                    ))}
                    {timeEntries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                          Записей табеля пока нет
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
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

      {isShiftModalOpen && (
        <NewShiftModal
          employees={employees}
          locations={locations}
          fixedLocationId={fixedLocationId}
          onClose={() => setIsShiftModalOpen(false)}
          onCreated={() => {
            setIsShiftModalOpen(false);
            loadShifts();
          }}
        />
      )}

      {isEmployeeModalOpen && (
        <EmployeeModal
          locations={locations}
          linkableUsers={availableUsersToLink}
          employee={editingEmployee}
          fixedLocationId={fixedLocationId}
          onClose={() => setIsEmployeeModalOpen(false)}
          onSaved={() => {
            setIsEmployeeModalOpen(false);
            loadEmployees();
          }}
        />
      )}

      {compensationEmployee && (
        <EmployeeCompensationModal
          employee={compensationEmployee}
          canManage={canManageEmployees}
          onClose={() => setCompensationEmployee(null)}
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
