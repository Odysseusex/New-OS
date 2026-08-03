import { Role } from "./roles";

export enum ShiftStatus {
  SCHEDULED = "SCHEDULED",
  CANCELLED = "CANCELLED",
}

export const SHIFT_STATUS_LABELS_RU: Record<ShiftStatus, string> = {
  [ShiftStatus.SCHEDULED]: "Запланирована",
  [ShiftStatus.CANCELLED]: "Отменена",
};

export interface EmployeeDto {
  id: string;
  fullName: string;
  role: Role;
  locationId: string | null;
  locationName: string | null;
}

export interface ShiftDto {
  id: string;
  locationId: string;
  locationName: string;
  userId: string;
  userFullName: string;
  userRole: Role;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  createdByName: string;
}

export interface CreateShiftRequestDto {
  locationId?: string;
  userId: string;
  startsAt: string;
  endsAt: string;
}

export interface TimeEntryDto {
  id: string;
  locationId: string;
  locationName: string;
  userId: string;
  userFullName: string;
  clockInAt: string;
  clockOutAt: string | null;
  hoursWorked: number | null;
}

export interface ClockInRequestDto {
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
