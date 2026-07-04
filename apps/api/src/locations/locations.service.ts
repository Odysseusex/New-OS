import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateLocationRequestDto,
  LocationComparisonDto,
  LocationDto,
  LocationOverviewDto,
  ORG_WIDE_ROLES,
  RegionDto,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string): Promise<LocationDto[]> {
    const locations = await this.prisma.location.findMany({
      where: { organizationId },
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

  async findComparison(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<LocationComparisonDto[]> {
    const [locations, sales, stockLevels, activeStaff, expenses] = await Promise.all([
      this.prisma.location.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
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
      if (level.quantity.toNumber() <= level.minQuantity.toNumber()) {
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
        where: { organizationId: user.organizationId },
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
      if (level.quantity.toNumber() <= level.minQuantity.toNumber()) {
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
    };
  }
}
