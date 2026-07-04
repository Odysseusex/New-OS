import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { LOGISTICS_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { VehiclesService } from "./vehicles.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("vehicles")
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.vehiclesService.findAllForOrganization(user.organizationId);
  }

  @Post()
  @Roles(...LOGISTICS_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(user.organizationId, dto);
  }
}
