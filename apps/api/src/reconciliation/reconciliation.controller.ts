import { Body, Controller, Get, Put, Query, UseGuards } from "@nestjs/common";
import { RECONCILIATION_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ReconciliationService } from "./reconciliation.service";
import { SaveDailyReconciliationDto } from "./dto/reconciliation.dto";

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
}
