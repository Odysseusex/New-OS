import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { FINANCE_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../auth/auth.types";
import { BalanceService } from "./balance.service";

const parseDate = (value: string | undefined, fallback: Date): Date => {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Неверная дата");
  return d;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance")
export class BalanceController {
  constructor(private balance: BalanceService) {}

  @Get("balance")
  sheet(@CurrentUser() user: AuthenticatedUser, @Query("asOf") asOf?: string) {
    return this.balance.getBalanceSheet(user.organizationId, parseDate(asOf, new Date()));
  }

  @Get("inventory-rollforward")
  rollForward(@CurrentUser() user: AuthenticatedUser, @Query("from") from: string, @Query("to") to: string) {
    return this.balance.getInventoryRollForward(user.organizationId, parseDate(from, new Date(0)), parseDate(to, new Date()));
  }

  @Get("monthly-report")
  monthly(@CurrentUser() user: AuthenticatedUser, @Query("year") year: string, @Query("month") month: string) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new BadRequestException("Неверный период");
    return this.balance.getMonthlyReport(user.organizationId, y, m);
  }
}
