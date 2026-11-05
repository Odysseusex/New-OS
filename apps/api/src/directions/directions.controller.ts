import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { DIRECTION_MANAGE_ROLES, HARD_DELETE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { DirectionsService } from "./directions.service";
import { CreateDirectionDto, UpdateDirectionDto } from "./dto/direction.dto";

@Controller("directions")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DirectionsController {
  constructor(private directions: DirectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.directions.list(user.organizationId);
  }

  @Post()
  @Roles(...DIRECTION_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDirectionDto) {
    return this.directions.create(user.organizationId, user.id, dto);
  }

  @Patch(":id")
  @Roles(...DIRECTION_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateDirectionDto) {
    return this.directions.update(user.organizationId, user.id, id, dto);
  }

  @Delete(":id")
  @Roles(...HARD_DELETE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.directions.remove(user.organizationId, user.id, id);
  }
}
