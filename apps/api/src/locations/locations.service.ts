import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LocationDto, LocationOverviewDto, ORG_WIDE_ROLES } from "@bakery-os/shared";
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
      regionId: loc.regionId,
      city: loc.city,
      address: loc.address,
      lat: loc.lat,
      lng: loc.lng,
    };
  }
}
