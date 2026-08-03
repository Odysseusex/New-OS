import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  DeliveryRouteDto,
  DeliveryRouteStatus,
  DriverDto,
  ORG_WIDE_ROLES,
  Role,
  RouteStopStatus,
  Unit,
} from "@bakery-os/shared";
import {
  DeliveryRouteStatus as PrismaDeliveryRouteStatus,
  RouteStopStatus as PrismaRouteStopStatus,
  StockMovementType,
} from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope } from "../common/location-scope";
import { CreateDeliveryRouteDto } from "./dto/create-route.dto";

const ROUTE_INCLUDE = {
  originLocation: true,
  vehicle: true,
  driver: true,
  createdBy: true,
  stops: {
    include: { destinationLocation: true, items: { include: { product: true } } },
    orderBy: { sequence: "asc" as const },
  },
};

@Injectable()
export class LogisticsService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser): Promise<DeliveryRouteDto[]> {
    const where = this.buildVisibilityFilter(user);

    const routes = await this.prisma.deliveryRoute.findMany({
      where: { organizationId: user.organizationId, ...where },
      include: ROUTE_INCLUDE,
      orderBy: { scheduledFor: "desc" },
      take: 100,
    });

    return routes.map(this.toDto);
  }

  async findDrivers(organizationId: string): Promise<DriverDto[]> {
    const drivers = await this.prisma.user.findMany({
      where: { organizationId, role: Role.DRIVER, isActive: true },
      orderBy: { fullName: "asc" },
    });

    return drivers.map((d) => ({ id: d.id, fullName: d.fullName }));
  }

  async create(user: AuthenticatedUser, dto: CreateDeliveryRouteDto): Promise<DeliveryRouteDto> {
    const originLocationId = requireLocationScope(user, dto.originLocationId);

    const destinationIds = dto.stops.map((s) => s.destinationLocationId);
    const destinations = await this.prisma.location.findMany({
      where: { id: { in: destinationIds }, organizationId: user.organizationId },
    });
    if (destinations.length !== new Set(destinationIds).size) {
      throw new BadRequestException("Одна или несколько точек назначения не найдены");
    }

    const productIds = dto.stops.flatMap((s) => s.items.map((i) => i.productId));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: user.organizationId },
    });
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException("Один или несколько товаров не найдены");
    }

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, organizationId: user.organizationId },
      });
      if (!vehicle) throw new NotFoundException("Транспорт не найден");
    }
    if (dto.driverId) {
      const driver = await this.prisma.user.findFirst({
        where: { id: dto.driverId, organizationId: user.organizationId, role: Role.DRIVER },
      });
      if (!driver) throw new NotFoundException("Водитель не найден");
    }

    const route = await this.prisma.deliveryRoute.create({
      data: {
        organizationId: user.organizationId,
        originLocationId,
        vehicleId: dto.vehicleId,
        driverId: dto.driverId,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
        createdById: user.id,
        stops: {
          create: dto.stops.map((stop, index) => ({
            destinationLocationId: stop.destinationLocationId,
            sequence: index + 1,
            items: {
              create: stop.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
            },
          })),
        },
      },
      include: ROUTE_INCLUDE,
    });

    return this.toDto(route);
  }

  async deliverStop(user: AuthenticatedUser, routeId: string, stopId: string): Promise<DeliveryRouteDto> {
    return this.prisma.$transaction(async (tx) => {
      const route = await tx.deliveryRoute.findFirst({
        where: { id: routeId, organizationId: user.organizationId },
        include: { stops: { include: { items: { include: { product: true } } } } },
      });
      if (!route) {
        throw new NotFoundException("Маршрут не найден");
      }
      this.assertRouteAccess(user, route);

      const stop = route.stops.find((s) => s.id === stopId);
      if (!stop) {
        throw new NotFoundException("Остановка не найдена");
      }
      if (stop.status !== PrismaRouteStopStatus.PENDING) {
        throw new BadRequestException("Эта остановка уже обработана");
      }
      if (route.status === PrismaDeliveryRouteStatus.CANCELLED) {
        throw new BadRequestException("Маршрут отменён");
      }

      for (const item of stop.items) {
        const stockLevel = await tx.stockLevel.findUnique({
          where: {
            locationId_productId: { locationId: route.originLocationId, productId: item.productId },
          },
        });
        if (!stockLevel || stockLevel.quantity.toNumber() < item.quantity.toNumber()) {
          throw new BadRequestException(
            `Недостаточно товара «${item.product.name}» в точке отправления для этой доставки`,
          );
        }
      }

      for (const item of stop.items) {
        await tx.stockLevel.update({
          where: {
            locationId_productId: { locationId: route.originLocationId, productId: item.productId },
          },
          data: { quantity: { decrement: item.quantity.toNumber() } },
        });
        await tx.stockLevel.upsert({
          where: {
            locationId_productId: { locationId: stop.destinationLocationId, productId: item.productId },
          },
          update: { quantity: { increment: item.quantity.toNumber() } },
          create: {
            organizationId: user.organizationId,
            locationId: stop.destinationLocationId,
            productId: item.productId,
            quantity: item.quantity.toNumber(),
            minQuantity: item.product.minQuantity,
          },
        });
      }

      await tx.stockMovement.createMany({
        data: stop.items.flatMap((item) => [
          {
            organizationId: user.organizationId,
            locationId: route.originLocationId,
            productId: item.productId,
            type: StockMovementType.TRANSFER_OUT,
            quantity: item.quantity,
            reason: "Отгрузка по маршруту доставки",
            routeStopId: stop.id,
            createdById: user.id,
          },
          {
            organizationId: user.organizationId,
            locationId: stop.destinationLocationId,
            productId: item.productId,
            type: StockMovementType.TRANSFER_IN,
            quantity: item.quantity,
            reason: "Поступление по маршруту доставки",
            routeStopId: stop.id,
            createdById: user.id,
          },
        ]),
      });

      await tx.routeStop.update({
        where: { id: stop.id },
        data: { status: PrismaRouteStopStatus.DELIVERED, deliveredAt: new Date() },
      });

      const remainingPending = route.stops.filter((s) => s.id !== stop.id && s.status === PrismaRouteStopStatus.PENDING);

      const updated = await tx.deliveryRoute.update({
        where: { id: route.id },
        data: {
          status:
            remainingPending.length === 0
              ? PrismaDeliveryRouteStatus.COMPLETED
              : PrismaDeliveryRouteStatus.IN_PROGRESS,
        },
        include: ROUTE_INCLUDE,
      });

      return this.toDto(updated);
    });
  }

  async cancel(user: AuthenticatedUser, routeId: string): Promise<DeliveryRouteDto> {
    const route = await this.prisma.deliveryRoute.findFirst({
      where: { id: routeId, organizationId: user.organizationId },
    });
    if (!route) {
      throw new NotFoundException("Маршрут не найден");
    }
    this.assertRouteAccess(user, route);
    if (route.status !== PrismaDeliveryRouteStatus.PLANNED) {
      throw new BadRequestException("Маршрут уже начат или завершён — отменить нельзя");
    }

    const updated = await this.prisma.deliveryRoute.update({
      where: { id: routeId },
      data: { status: PrismaDeliveryRouteStatus.CANCELLED },
      include: ROUTE_INCLUDE,
    });

    return this.toDto(updated);
  }

  private buildVisibilityFilter(user: AuthenticatedUser) {
    if (ORG_WIDE_ROLES.includes(user.role)) return {};
    if (user.role === Role.DRIVER) return { driverId: user.id };
    return { originLocationId: user.locationId ?? "__none__" };
  }

  private assertRouteAccess(user: AuthenticatedUser, route: { originLocationId: string; driverId: string | null }) {
    if (ORG_WIDE_ROLES.includes(user.role)) return;
    if (user.role === Role.DRIVER) {
      if (route.driverId !== user.id) {
        throw new ForbiddenException("Этот маршрут назначен другому водителю");
      }
      return;
    }
    if (route.originLocationId !== user.locationId) {
      throw new ForbiddenException("Нет доступа к маршруту другой точки");
    }
  }

  private toDto = (route: {
    id: string;
    originLocationId: string;
    originLocation: { name: string };
    vehicleId: string | null;
    vehicle: { name: string } | null;
    driverId: string | null;
    driver: { fullName: string } | null;
    status: string;
    scheduledFor: Date;
    createdBy: { fullName: string };
    stops: {
      id: string;
      destinationLocationId: string;
      destinationLocation: { name: string };
      sequence: number;
      status: string;
      deliveredAt: Date | null;
      items: {
        id: string;
        productId: string;
        product: { name: string; unit: string };
        quantity: { toNumber: () => number };
      }[];
    }[];
  }): DeliveryRouteDto => ({
    id: route.id,
    originLocationId: route.originLocationId,
    originLocationName: route.originLocation.name,
    vehicleId: route.vehicleId,
    vehicleName: route.vehicle?.name ?? null,
    driverId: route.driverId,
    driverName: route.driver?.fullName ?? null,
    status: route.status as DeliveryRouteStatus,
    scheduledFor: route.scheduledFor.toISOString(),
    createdByName: route.createdBy.fullName,
    stops: route.stops.map((stop) => ({
      id: stop.id,
      destinationLocationId: stop.destinationLocationId,
      destinationLocationName: stop.destinationLocation.name,
      sequence: stop.sequence,
      status: stop.status as RouteStopStatus,
      deliveredAt: stop.deliveredAt ? stop.deliveredAt.toISOString() : null,
      items: stop.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        unit: item.product.unit as Unit,
        quantity: item.quantity.toNumber(),
      })),
    })),
  });
}
