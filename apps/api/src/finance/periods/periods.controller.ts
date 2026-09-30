import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { FINANCE_VIEW_ROLES, HARD_DELETE_ROLES, Role } from "@bakery-os/shared";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../auth/auth.types";
import { FinancialPeriodsService } from "./periods.service";
import { IsString, MinLength } from "class-validator";

class ReopenPeriodDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance/periods")
export class FinancialPeriodsController {
  constructor(private periods: FinancialPeriodsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.periods.list(user.organizationId);
  }

  @Get(":year/:month/preflight")
  preflight(
    @CurrentUser() user: AuthenticatedUser,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
  ) {
    return this.periods.preflight(user.organizationId, year, month);
  }

  @Get(":year/:month/snapshot")
  snapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
    @Query("version") version?: string,
  ) {
    return this.periods.getSnapshot(user.organizationId, year, month, version ? Number(version) : undefined);
  }

  @Get(":year/:month/snapshots")
  snapshots(
    @CurrentUser() user: AuthenticatedUser,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
  ) {
    return this.periods.listSnapshotVersions(user.organizationId, year, month);
  }

  @Post(":year/:month/close")
  @Roles(...HARD_DELETE_ROLES)
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
  ) {
    return this.periods.close(user, year, month);
  }

  // Owner only — enforced again inside the service.
  @Post(":year/:month/reopen")
  @Roles(Role.OWNER)
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
    @Body() dto: ReopenPeriodDto,
  ) {
    return this.periods.reopen(user, year, month, dto.reason);
  }
}
