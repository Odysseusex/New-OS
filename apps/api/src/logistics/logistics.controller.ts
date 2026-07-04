import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { LOGISTICS_MANAGE_ROLES, ROUTE_EXECUTE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { LogisticsService } from "./logistics.service";
import { CreateDeliveryRouteDto } from "./dto/create-route.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("logistics")
export class LogisticsController {
  constructor(private logisticsService: LogisticsService) {}

  @Get("routes")
  @Roles(...ROUTE_EXECUTE_ROLES)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.logisticsService.findAll(user);
  }

  @Get("drivers")
  @Roles(...LOGISTICS_MANAGE_ROLES)
  findDrivers(@CurrentUser() user: AuthenticatedUser) {
    return this.logisticsService.findDrivers(user.organizationId);
  }

  @Post("routes")
  @Roles(...LOGISTICS_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDeliveryRouteDto) {
    return this.logisticsService.create(user, dto);
  }

  @Post("routes/:routeId/stops/:stopId/deliver")
  @Roles(...ROUTE_EXECUTE_ROLES)
  deliverStop(
    @CurrentUser() user: AuthenticatedUser,
    @Param("routeId") routeId: string,
    @Param("stopId") stopId: string,
  ) {
    return this.logisticsService.deliverStop(user, routeId, stopId);
  }

  @Post("routes/:routeId/cancel")
  @Roles(...LOGISTICS_MANAGE_ROLES)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("routeId") routeId: string) {
    return this.logisticsService.cancel(user, routeId);
  }
}
