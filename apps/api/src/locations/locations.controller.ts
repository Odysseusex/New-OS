import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { HARD_DELETE_ROLES, LOCATION_MANAGE_ROLES, NETWORK_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { LocationsService } from "./locations.service";
import { CreateLocationDto } from "./dto/create-location.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";

@UseGuards(JwtAuthGuard)
@Controller("locations")
export class LocationsController {
  constructor(private locationsService: LocationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    return this.locationsService.findAllForOrganization(user.organizationId, includeArchived === "true");
  }

  @Get("overview")
  findOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.locationsService.findOverview(user);
  }

  @Get("regions")
  findRegions(@CurrentUser() user: AuthenticatedUser) {
    return this.locationsService.findRegions(user.organizationId);
  }

  @Get("comparison")
  @UseGuards(RolesGuard)
  @Roles(...NETWORK_VIEW_ROLES)
  findComparison(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.locationsService.findComparison(user.organizationId, new Date(from), new Date(to));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(...LOCATION_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLocationDto) {
    return this.locationsService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(...LOCATION_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateLocationDto) {
    return this.locationsService.update(user.organizationId, id, dto);
  }

  @Post(":id/archive")
  @UseGuards(RolesGuard)
  @Roles(...LOCATION_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.locationsService.archive(user.organizationId, id);
  }

  @Post(":id/restore")
  @UseGuards(RolesGuard)
  @Roles(...LOCATION_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.locationsService.restore(user.organizationId, id);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(...HARD_DELETE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.locationsService.remove(user.organizationId, id);
  }
}
