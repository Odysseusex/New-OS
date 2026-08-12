import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmployeeKpiDto, HrKpiResponseDto, Role, ShiftDto, ShiftStatus, TimeEntryDto } from "@bakery-os/shared";
import { ShiftStatus as PrismaShiftStatus, StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreateShiftDto } from "./dto/create-shift.dto";
import { ClockInDto } from "./dto/clock-in.dto";
import { ClockInForDto } from "./dto/clock-in-for.dto";

@Injectable()
export class HrService {
  constructor(private prisma: PrismaService) {}

  async listShifts(user: AuthenticatedUser, requestedLocationId?: string): Promise<ShiftDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const shifts = await this.prisma.shift.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, employee: true, createdBy: true },
      orderBy: { startsAt: "desc" },
      take: 200,
    });

    return shifts.map(this.toShiftDto);
  }

  async listMyShifts(user: AuthenticatedUser): Promise<ShiftDto[]> {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) {
      return [];
    }

    const shifts = await this.prisma.shift.findMany({
      where: { organizationId: user.organizationId, employeeId: employee.id },
      include: { location: true, employee: true, createdBy: true },
      orderBy: { startsAt: "desc" },
      take: 50,
    });

    return shifts.map(this.toShiftDto);
  }

  async createShift(user: AuthenticatedUser, dto: CreateShiftDto): Promise<ShiftDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }

    if (new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new BadRequestException("Окончание смены должно быть позже начала");
    }

    const shift = await this.prisma.shift.create({
      data: {
        organizationId: user.organizationId,
        locationId,
        employeeId: dto.employeeId,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        createdById: user.id,
      },
      include: { location: true, employee: true, createdBy: true },
    });

    return this.toShiftDto(shift);
  }

  async cancelShift(user: AuthenticatedUser, shiftId: string): Promise<ShiftDto> {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, organizationId: user.organizationId },
    });
    if (!shift) {
      throw new NotFoundException("Смена не найдена");
    }
    resolveLocationScope(user, shift.locationId);
    if (shift.status !== PrismaShiftStatus.SCHEDULED) {
      throw new BadRequestException("Эту смену уже нельзя отменить");
    }

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: { status: PrismaShiftStatus.CANCELLED },
      include: { location: true, employee: true, createdBy: true },
    });

    return this.toShiftDto(updated);
  }

  async listTimeEntries(user: AuthenticatedUser, requestedLocationId?: string): Promise<TimeEntryDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, employee: true, recordedBy: true },
      orderBy: { clockInAt: "desc" },
      take: 200,
    });

    return entries.map(this.toTimeEntryDto);
  }

  async listMyTimeEntries(user: AuthenticatedUser): Promise<TimeEntryDto[]> {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) {
      return [];
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: { organizationId: user.organizationId, employeeId: employee.id },
      include: { location: true, employee: true, recordedBy: true },
      orderBy: { clockInAt: "desc" },
      take: 30,
    });

    return entries.map(this.toTimeEntryDto);
  }

  async clockIn(user: AuthenticatedUser, dto: ClockInDto): Promise<TimeEntryDto> {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) {
      throw new BadRequestException("Ваш аккаунт не привязан к сотруднику");
    }

    const locationId = dto.locationId ?? employee.locationId ?? user.locationId;
    if (!locationId) {
      throw new BadRequestException("Укажите точку для отметки начала смены");
    }

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { organizationId: user.organizationId, employeeId: employee.id, clockOutAt: null },
    });
    if (openEntry) {
      throw new BadRequestException("У вас уже есть открытая смена — сначала завершите её");
    }

    const entry = await this.prisma.timeEntry.create({
      data: {
        organizationId: user.organizationId,
        locationId,
        employeeId: employee.id,
        recordedById: user.id,
      },
      include: { location: true, employee: true, recordedBy: true },
    });

    return this.toTimeEntryDto(entry);
  }

  async clockOut(user: AuthenticatedUser): Promise<TimeEntryDto> {
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) {
      throw new BadRequestException("Ваш аккаунт не привязан к сотруднику");
    }

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { organizationId: user.organizationId, employeeId: employee.id, clockOutAt: null },
      orderBy: { clockInAt: "desc" },
    });
    if (!openEntry) {
      throw new BadRequestException("Нет открытой смены, которую можно завершить");
    }

    const entry = await this.prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: { clockOutAt: new Date() },
      include: { location: true, employee: true, recordedBy: true },
    });

    return this.toTimeEntryDto(entry);
  }

  // Manager-assisted clock-in/out — for employees with no ERP login of
  // their own. The acting manager is recorded as recordedById.
  async clockInFor(user: AuthenticatedUser, employeeId: string, dto: ClockInForDto): Promise<TimeEntryDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }
    resolveLocationScope(user, employee.locationId ?? undefined);

    const locationId = dto.locationId ?? employee.locationId ?? user.locationId;
    if (!locationId) {
      throw new BadRequestException("Укажите точку для отметки начала смены");
    }

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { organizationId: user.organizationId, employeeId, clockOutAt: null },
    });
    if (openEntry) {
      throw new BadRequestException("У этого сотрудника уже есть открытая смена — сначала завершите её");
    }

    const entry = await this.prisma.timeEntry.create({
      data: {
        organizationId: user.organizationId,
        locationId,
        employeeId,
        recordedById: user.id,
      },
      include: { location: true, employee: true, recordedBy: true },
    });

    return this.toTimeEntryDto(entry);
  }

  async clockOutFor(user: AuthenticatedUser, employeeId: string): Promise<TimeEntryDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }
    resolveLocationScope(user, employee.locationId ?? undefined);

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { organizationId: user.organizationId, employeeId, clockOutAt: null },
      orderBy: { clockInAt: "desc" },
    });
    if (!openEntry) {
      throw new BadRequestException("Нет открытой смены, которую можно завершить");
    }

    const entry = await this.prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: { clockOutAt: new Date() },
      include: { location: true, employee: true, recordedBy: true },
    });

    return this.toTimeEntryDto(entry);
  }

  async getKpi(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    requestedLocationId?: string,
  ): Promise<HrKpiResponseDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const [employees, salesByEmployee, productionByEmployee] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          organizationId: user.organizationId,
          isActive: true,
          ...(locationId ? { locationId } : {}),
        },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.sale.groupBy({
        by: ["createdById"],
        where: {
          organizationId: user.organizationId,
          soldAt: { gte: from, lte: to },
          ...(locationId ? { locationId } : {}),
        },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.stockMovement.groupBy({
        by: ["createdById"],
        where: {
          organizationId: user.organizationId,
          type: StockMovementType.PRODUCTION_OUTPUT,
          createdAt: { gte: from, lte: to },
          ...(locationId ? { locationId } : {}),
        },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
    ]);

    const salesMap = new Map(salesByEmployee.map((s) => [s.createdById, s]));
    const productionMap = new Map(productionByEmployee.map((p) => [p.createdById, p]));

    const kpiEmployees: EmployeeKpiDto[] = employees.map((e) => {
      const sales = salesMap.get(e.id);
      const production = productionMap.get(e.id);

      return {
        userId: e.id,
        userFullName: e.fullName,
        role: e.role as Role,
        salesCount: sales?._count._all ?? 0,
        salesRevenue: sales?._sum.totalAmount?.toNumber() ?? 0,
        batchesCompleted: production?._count._all ?? 0,
        unitsProduced: production?._sum.quantity?.toNumber() ?? 0,
      };
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      employees: kpiEmployees,
    };
  }

  private toShiftDto = (shift: {
    id: string;
    locationId: string;
    location: { name: string };
    employeeId: string;
    employee: { fullName: string; position: string };
    startsAt: Date;
    endsAt: Date;
    status: string;
    createdBy: { fullName: string };
  }): ShiftDto => ({
    id: shift.id,
    locationId: shift.locationId,
    locationName: shift.location.name,
    employeeId: shift.employeeId,
    employeeFullName: shift.employee.fullName,
    employeePosition: shift.employee.position,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    status: shift.status as ShiftStatus,
    createdByName: shift.createdBy.fullName,
  });

  private toTimeEntryDto = (entry: {
    id: string;
    locationId: string;
    location: { name: string };
    employeeId: string;
    employee: { fullName: string };
    clockInAt: Date;
    clockOutAt: Date | null;
    recordedBy: { fullName: string };
  }): TimeEntryDto => ({
    id: entry.id,
    locationId: entry.locationId,
    locationName: entry.location.name,
    employeeId: entry.employeeId,
    employeeFullName: entry.employee.fullName,
    clockInAt: entry.clockInAt.toISOString(),
    clockOutAt: entry.clockOutAt ? entry.clockOutAt.toISOString() : null,
    hoursWorked: entry.clockOutAt
      ? (entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / (1000 * 60 * 60)
      : null,
    recordedByName: entry.recordedBy.fullName,
  });
}
