import { Body, Controller, Get, Post, Put, Query, UseGuards } from "@nestjs/common";
import { INVENTORY_MANAGE_ROLES, RECONCILIATION_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ReconciliationService } from "./reconciliation.service";
import { ApplyDailyReconciliationDto, SaveDailyReconciliationDto } from "./dto/reconciliation.dto";

// Class-level gate: cashiers count blind and never see what the system expects.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...RECONCILIATION_ROLES)
@Controller("reconciliation")
export class ReconciliationController {
  constructor(private service: ReconciliationService) {}

  @Get("history")
  history(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.service.history(user, locationId);
  }

  @Get("product-trail")
  productTrail(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId: string | undefined,
    @Query("date") date: string,
    @Query("productId") productId: string,
  ) {
    return this.service.productTrail(user, locationId, date, productId);
  }

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId: string | undefined, @Query("date") date: string) {
    return this.service.get(user, locationId, date);
  }

  @Put()
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveDailyReconciliationDto) {
    return this.service.save(user, dto);
  }

  // Corrects stock: the same people who may make a «Корректировка» on Склад.
  @Post("apply")
  @Roles(...INVENTORY_MANAGE_ROLES)
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyDailyReconciliationDto) {
    return this.service.apply(user, dto.locationId, dto.date);
  }
}
