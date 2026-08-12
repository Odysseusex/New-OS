import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CompensationType,
  EmployeeCompensationDto,
  EmployeeDto,
  EmployeeStatus,
  Role,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { resolveLocationScope } from "../common/location-scope";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { AddCompensationDto } from "./dto/add-compensation.dto";

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async list(
    user: AuthenticatedUser,
    requestedLocationId?: string,
    includeArchived = false,
  ): Promise<EmployeeDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
        ...(includeArchived ? {} : { status: EmployeeStatus.ACTIVE }),
      },
      include: { location: true, user: true },
      orderBy: { fullName: "asc" },
    });

    return employees.map(this.toDto);
  }

  async create(user: AuthenticatedUser, dto: CreateEmployeeDto): Promise<EmployeeDto> {
    const locationId = resolveLocationScope(user, dto.locationId);

    if (dto.userId) {
      const linkedUser = await this.prisma.user.findFirst({
        where: { id: dto.userId, organizationId: user.organizationId },
      });
      if (!linkedUser) {
        throw new NotFoundException("Пользователь не найден");
      }
      const existingLink = await this.prisma.employee.findUnique({ where: { userId: dto.userId } });
      if (existingLink) {
        throw new BadRequestException("Этот пользователь уже привязан к другому сотруднику");
      }
    }

    const employee = await this.prisma.employee.create({
      data: {
        organizationId: user.organizationId,
        locationId: locationId ?? null,
        fullName: dto.fullName,
        position: dto.position,
        phone: dto.phone,
        hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : undefined,
        userId: dto.userId,
      },
      include: { location: true, user: true },
    });

    return this.toDto(employee);
  }

  async update(user: AuthenticatedUser, employeeId: string, dto: UpdateEmployeeDto): Promise<EmployeeDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }

    const locationId =
      dto.locationId !== undefined ? resolveLocationScope(user, dto.locationId) ?? null : undefined;

    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        fullName: dto.fullName,
        position: dto.position,
        phone: dto.phone,
        hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : undefined,
        ...(locationId !== undefined ? { locationId } : {}),
      },
      include: { location: true, user: true },
    });

    return this.toDto(updated);
  }

  async archive(user: AuthenticatedUser, employeeId: string): Promise<EmployeeDto> {
    return this.setStatus(user, employeeId, EmployeeStatus.INACTIVE);
  }

  async restore(user: AuthenticatedUser, employeeId: string): Promise<EmployeeDto> {
    return this.setStatus(user, employeeId, EmployeeStatus.ACTIVE);
  }

  async remove(user: AuthenticatedUser, employeeId: string): Promise<{ deleted: true }> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }

    const [shifts, timeEntries] = await Promise.all([
      this.prisma.shift.count({ where: { employeeId } }),
      this.prisma.timeEntry.count({ where: { employeeId } }),
    ]);
    if (shifts + timeEntries > 0) {
      throw new BadRequestException(
        "Нельзя удалить сотрудника — с ним уже связаны смены или табель. Заархивируйте его вместо удаления.",
      );
    }

    await this.prisma.employee.delete({ where: { id: employeeId } });
    return { deleted: true };
  }

  async listCompensations(user: AuthenticatedUser, employeeId: string): Promise<EmployeeCompensationDto[]> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }

    const compensations = await this.prisma.employeeCompensation.findMany({
      where: { employeeId, organizationId: user.organizationId },
      include: { createdBy: true },
      orderBy: { effectiveFrom: "desc" },
    });

    return compensations.map(this.toCompensationDto);
  }

  async addCompensation(
    user: AuthenticatedUser,
    employeeId: string,
    dto: AddCompensationDto,
  ): Promise<EmployeeCompensationDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    const openRate = await this.prisma.employeeCompensation.findFirst({
      where: { employeeId, effectiveTo: null },
    });
    if (openRate && effectiveFrom <= openRate.effectiveFrom) {
      throw new BadRequestException(
        "Дата вступления в силу новой ставки должна быть позже даты предыдущей ставки",
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (openRate) {
        await tx.employeeCompensation.update({
          where: { id: openRate.id },
          data: { effectiveTo: effectiveFrom },
        });
      }

      return tx.employeeCompensation.create({
        data: {
          organizationId: user.organizationId,
          employeeId,
          amount: dto.amount,
          paymentType: dto.paymentType ?? CompensationType.MONTHLY,
          effectiveFrom,
          createdById: user.id,
        },
        include: { createdBy: true },
      });
    });

    return this.toCompensationDto(created);
  }

  private async setStatus(
    user: AuthenticatedUser,
    employeeId: string,
    status: EmployeeStatus,
  ): Promise<EmployeeDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
    });
    if (!employee) {
      throw new NotFoundException("Сотрудник не найден");
    }
    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { status },
      include: { location: true, user: true },
    });
    return this.toDto(updated);
  }

  private toDto = (employee: {
    id: string;
    fullName: string;
    position: string;
    locationId: string | null;
    location: { name: string } | null;
    phone: string | null;
    hiredAt: Date | null;
    status: string;
    userId: string | null;
    user: { email: string; role: string } | null;
  }): EmployeeDto => ({
    id: employee.id,
    fullName: employee.fullName,
    position: employee.position,
    locationId: employee.locationId,
    locationName: employee.location?.name ?? null,
    phone: employee.phone,
    hiredAt: employee.hiredAt ? employee.hiredAt.toISOString() : null,
    status: employee.status as EmployeeStatus,
    isActive: employee.status === EmployeeStatus.ACTIVE,
    userId: employee.userId,
    userEmail: employee.user?.email ?? null,
    userRole: (employee.user?.role as Role) ?? null,
  });

  private toCompensationDto = (compensation: {
    id: string;
    amount: { toNumber: () => number };
    paymentType: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    createdBy: { fullName: string };
    createdAt: Date;
  }): EmployeeCompensationDto => ({
    id: compensation.id,
    amount: compensation.amount.toNumber(),
    paymentType: compensation.paymentType as CompensationType,
    effectiveFrom: compensation.effectiveFrom.toISOString(),
    effectiveTo: compensation.effectiveTo ? compensation.effectiveTo.toISOString() : null,
    createdByName: compensation.createdBy.fullName,
    createdAt: compensation.createdAt.toISOString(),
  });
}
