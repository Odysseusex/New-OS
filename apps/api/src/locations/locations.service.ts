import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateLocationRequestDto,
  isStockLow,
  LocationComparisonDto,
  LocationDto,
  LocationOverviewDto,
  ORG_WIDE_ROLES,
  RegionDto,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { UpdateLocationDto } from "./dto/update-location.dto";

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<LocationDto[]> {
    const locations = await this.prisma.location.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: { name: "asc" },
    });

    return locations.map(this.toDto);
  }

  async findRegions(organizationId: string): Promise<RegionDto[]> {
    const regions = await this.prisma.region.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
    return regions.map((r) => ({ id: r.id, name: r.name }));
  }

  async create(organizationId: string, dto: CreateLocationRequestDto): Promise<LocationDto> {
    const location = await this.prisma.location.create({
      data: {
        organizationId,
        name: dto.name,
        type: dto.type,
        ownership: dto.ownership,
        regionId: dto.regionId,
        city: dto.city,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
      },
    });
    return this.toDto(location);
  }

  async update(organizationId: string, locationId: string, dto: UpdateLocationDto): Promise<LocationDto> {
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId } });
    if (!location) {
      throw new NotFoundException("Точка не найдена");
    }
    const updated = await this.prisma.location.update({ where: { id: locationId }, data: dto });
    return this.toDto(updated);
  }

  async archive(organizationId: string, locationId: string): Promise<LocationDto> {
    return this.setActive(organizationId, locationId, false);
  }

  async restore(organizationId: string, locationId: string): Promise<LocationDto> {
    return this.setActive(organizationId, locationId, true);
  }

  async remove(organizationId: string, locationId: string): Promise<{ deleted: true }> {
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId } });
    if (!location) {
      throw new NotFoundException("Точка не найдена");
    }

    const [users, movements, sales, batches, orders, routes, stops, expenses, shifts, employees, timeEntries] =
      await Promise.all([
        this.prisma.user.count({ where: { locationId } }),
        this.prisma.stockMovement.count({ where: { locationId } }),
        this.prisma.sale.count({ where: { locationId } }),
        this.prisma.productionBatch.count({ where: { locationId } }),
        this.prisma.purchaseOrder.count({ where: { locationId } }),
        this.prisma.deliveryRoute.count({ where: { originLocationId: locationId } }),
        this.prisma.routeStop.count({ where: { destinationLocationId: locationId } }),
        this.prisma.expense.count({ where: { locationId } }),
        this.prisma.shift.count({ where: { locationId } }),
        this.prisma.employee.count({ where: { locationId } }),
        this.prisma.timeEntry.count({ where: { locationId } }),
      ]);
    const usageCount =
      users + movements + sales + batches + orders + routes + stops + expenses + shifts + employees + timeEntries;
    if (usageCount > 0) {
      throw new BadRequestException(
        "Нельзя удалить точку — с ней уже связаны данные (сотрудники, документы или остатки). Заархивируйте её вместо удаления.",
      );
    }

    await this.prisma.location.delete({ where: { id: locationId } });
    return { deleted: true };
  }

  private async setActive(organizationId: string, locationId: string, isActive: boolean): Promise<LocationDto> {
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId } });
    if (!location) {
      throw new NotFoundException("Точка не найдена");
    }
    const updated = await this.prisma.location.update({ where: { id: locationId }, data: { isActive } });
    return this.toDto(updated);
  }

  async findComparison(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<LocationComparisonDto[]> {
    const [locations, sales, stockLevels, activeStaff, expenses] = await Promise.all([
      this.prisma.location.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" } }),
      this.prisma.sale.findMany({
        where: { organizationId, soldAt: { gte: from, lte: to } },
      }),
      this.prisma.stockLevel.findMany({ where: { organizationId } }),
      this.prisma.user.findMany({
        where: { organizationId, isActive: true, locationId: { not: null } },
      }),
      this.prisma.expense.findMany({
        where: { organizationId, incurredOn: { gte: from, lte: to } },
      }),
    ]);

    const revenueByLocation = new Map<string, number>();
    const salesCountByLocation = new Map<string, number>();
    for (const sale of sales) {
      revenueByLocation.set(
        sale.locationId,
        (revenueByLocation.get(sale.locationId) ?? 0) + sale.totalAmount.toNumber(),
      );
      salesCountByLocation.set(sale.locationId, (salesCountByLocation.get(sale.locationId) ?? 0) + 1);
    }

    const lowStockByLocation = new Map<string, number>();
    for (const level of stockLevels) {
      if (isStockLow(level.quantity.toNumber(), level.minQuantity.toNumber())) {
        lowStockByLocation.set(level.locationId, (lowStockByLocation.get(level.locationId) ?? 0) + 1);
      }
    }

    const staffCountByLocation = new Map<string, number>();
    for (const user of activeStaff) {
      const locationId = user.locationId as string;
      staffCountByLocation.set(locationId, (staffCountByLocation.get(locationId) ?? 0) + 1);
    }

    const expensesByLocation = new Map<string, number>();
    for (const expense of expenses) {
      if (!expense.locationId) continue;
      expensesByLocation.set(
        expense.locationId,
        (expensesByLocation.get(expense.locationId) ?? 0) + expense.amount.toNumber(),
      );
    }

    return locations.map((loc) => {
      const revenue = revenueByLocation.get(loc.id) ?? 0;
      const salesCount = salesCountByLocation.get(loc.id) ?? 0;
      return {
        ...this.toDto(loc),
        revenue,
        salesCount,
        averageTicket: salesCount > 0 ? revenue / salesCount : 0,
        lowStockCount: lowStockByLocation.get(loc.id) ?? 0,
        activeStaffCount: staffCountByLocation.get(loc.id) ?? 0,
        expenses: expensesByLocation.get(loc.id) ?? 0,
      };
    });
  }

  async findOverview(user: AuthenticatedUser): Promise<LocationOverviewDto[]> {
    const isOrgWide = ORG_WIDE_ROLES.includes(user.role);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [locations, todaySales, stockLevels] = await Promise.all([
      this.prisma.location.findMany({
        where: { organizationId: user.organizationId, isActive: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.sale.findMany({
        where: { organizationId: user.organizationId, soldAt: { gte: startOfToday } },
      }),
      this.prisma.stockLevel.findMany({ where: { organizationId: user.organizationId } }),
    ]);

    const revenueByLocation = new Map<string, number>();
    for (const sale of todaySales) {
      revenueByLocation.set(
        sale.locationId,
        (revenueByLocation.get(sale.locationId) ?? 0) + sale.totalAmount.toNumber(),
      );
    }

    const lowStockByLocation = new Map<string, number>();
    for (const level of stockLevels) {
      if (isStockLow(level.quantity.toNumber(), level.minQuantity.toNumber())) {
        lowStockByLocation.set(level.locationId, (lowStockByLocation.get(level.locationId) ?? 0) + 1);
      }
    }

    return locations.map((loc) => {
      const canSeeMetrics = isOrgWide || loc.id === user.locationId;
      return {
        ...this.toDto(loc),
        todayRevenue: canSeeMetrics ? (revenueByLocation.get(loc.id) ?? 0) : null,
        lowStockCount: canSeeMetrics ? (lowStockByLocation.get(loc.id) ?? 0) : null,
      };
    });
  }

  private toDto(loc: {
    id: string;
    name: string;
    type: string;
    ownership: string;
    regionId: string | null;
    city: string;
    address: string;
    lat: number | null;
    lng: number | null;
    isActive: boolean;
  }): LocationDto {
    return {
      id: loc.id,
      name: loc.name,
      type: loc.type as LocationDto["type"],
      ownership: loc.ownership as LocationDto["ownership"],
      regionId: loc.regionId,
      city: loc.city,
      address: loc.address,
      lat: loc.lat,
      lng: loc.lng,
      isActive: loc.isActive,
    };
  }
}
