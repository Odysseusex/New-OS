import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PURCHASE_ORDER_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProcurementService } from "./procurement.service";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("procurement/orders")
export class ProcurementController {
  constructor(private procurementService: ProcurementService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.procurementService.findAll(user, locationId);
  }

  @Post()
  @Roles(...PURCHASE_ORDER_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.procurementService.create(user, dto);
  }

  @Post(":id/receive")
  @Roles(...PURCHASE_ORDER_MANAGE_ROLES)
  receive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.procurementService.receive(user, id);
  }

  @Post(":id/cancel")
  @Roles(...PURCHASE_ORDER_MANAGE_ROLES)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.procurementService.cancel(user, id);
  }
}
