import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LOGISTICS_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { VehiclesService } from "./vehicles.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("vehicles")
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    return this.vehiclesService.findAllForOrganization(user.organizationId, includeArchived === "true");
  }

  @Post()
  @Roles(...LOGISTICS_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(...LOGISTICS_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehiclesService.update(user.organizationId, id, dto);
  }

  @Post(":id/archive")
  @Roles(...LOGISTICS_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.vehiclesService.archive(user.organizationId, id);
  }

  @Post(":id/restore")
  @Roles(...LOGISTICS_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.vehiclesService.restore(user.organizationId, id);
  }

  @Delete(":id")
  @Roles(...LOGISTICS_MANAGE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.vehiclesService.remove(user.organizationId, id);
  }
}
