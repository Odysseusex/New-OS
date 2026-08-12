import { Role } from "./roles";

export enum ShiftStatus {
  SCHEDULED = "SCHEDULED",
  CANCELLED = "CANCELLED",
}

export const SHIFT_STATUS_LABELS_RU: Record<ShiftStatus, string> = {
  [ShiftStatus.SCHEDULED]: "Запланирована",
  [ShiftStatus.CANCELLED]: "Отменена",
};

export enum EmployeeStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export const EMPLOYEE_STATUS_LABELS_RU: Record<EmployeeStatus, string> = {
  [EmployeeStatus.ACTIVE]: "Активен",
  [EmployeeStatus.INACTIVE]: "Неактивен",
};

// The rate/frequency a compensation figure is quoted in — a label only; no
// payroll calculation reads this yet (see EmployeeCompensationDto).
export enum CompensationType {
  MONTHLY = "MONTHLY",
  HOURLY = "HOURLY",
  PIECE_RATE = "PIECE_RATE",
}

export const COMPENSATION_TYPE_LABELS_RU: Record<CompensationType, string> = {
  [CompensationType.MONTHLY]: "Оклад в месяц",
  [CompensationType.HOURLY]: "Почасовая",
  [CompensationType.PIECE_RATE]: "Сдельная",
};

// A real member of staff — independent of whether they have ERP access.
// See CLAUDE.md / the HR-foundation architecture notes for why this is a
// separate entity from User.
export interface EmployeeDto {
  id: string;
  fullName: string;
  position: string;
  locationId: string | null;
  locationName: string | null;
  phone: string | null;
  hiredAt: string | null;
  status: EmployeeStatus;
  // Derived from status === ACTIVE, so the frontend can reuse the existing
  // ArchivedBadge/ArchivedToggle/RowActions components as-is.
  isActive: boolean;
  // Present only when this employee also has ERP access.
  userId: string | null;
  userEmail: string | null;
  userRole: Role | null;
}

export interface CreateEmployeeRequestDto {
  fullName: string;
  position: string;
  locationId?: string;
  phone?: string;
  hiredAt?: string;
  // Link to an existing User at creation time — optional, since most
  // employees won't have one.
  userId?: string;
}

export interface UpdateEmployeeRequestDto {
  fullName?: string;
  position?: string;
  locationId?: string;
  phone?: string;
  hiredAt?: string;
}

// Plain management/planning figure — never a payroll calculation input and
// never auto-connected to real money movement. See the schema comment on
// EmployeeCompensation for the full reasoning.
export interface EmployeeCompensationDto {
  id: string;
  amount: number;
  paymentType: CompensationType;
  effectiveFrom: string;
  // Null = this is the currently active rate.
  effectiveTo: string | null;
  createdByName: string;
  createdAt: string;
}

export interface AddEmployeeCompensationRequestDto {
  amount: number;
  paymentType?: CompensationType;
  // Defaults to now if omitted.
  effectiveFrom?: string;
}

export interface ShiftDto {
  id: string;
  locationId: string;
  locationName: string;
  employeeId: string;
  employeeFullName: string;
  employeePosition: string;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  createdByName: string;
}

export interface CreateShiftRequestDto {
  locationId?: string;
  employeeId: string;
  startsAt: string;
  endsAt: string;
}

export interface TimeEntryDto {
  id: string;
  locationId: string;
  locationName: string;
  employeeId: string;
  employeeFullName: string;
  clockInAt: string;
  clockOutAt: string | null;
  hoursWorked: number | null;
  // Who performed the clock-in/out — the employee themself, or a manager
  // acting on behalf of an employee with no ERP login.
  recordedByName: string;
}

export interface ClockInRequestDto {
  locationId?: string;
}

// Manager-assisted clock-in/out for an employee with no ERP login of their
// own — the target employee is in the URL, not the body.
export interface ClockInForRequestDto {
  locationId?: string;
}

export interface EmployeeKpiDto {
  userId: string;
  userFullName: string;
  role: Role;
  salesCount: number;
  salesRevenue: number;
  batchesCompleted: number;
  unitsProduced: number;
}

export interface HrKpiResponseDto {
  from: string;
  to: string;
  employees: EmployeeKpiDto[];
}
