import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { INVENTORY_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { StandingOrdersService } from "./standing-orders.service";
import { SaveStandingOrderDto } from "./save-standing-order.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("distribution/standing-orders")
export class StandingOrdersController {
  constructor(private service: StandingOrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Put()
  @Roles(...INVENTORY_MANAGE_ROLES)
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveStandingOrderDto) {
    return this.service.save(user, dto);
  }
}
