import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { EXPENSE_MANAGE_ROLES, FINANCE_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { FinanceService } from "./finance.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { GetPnlQueryDto } from "./dto/get-pnl-query.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance")
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Get("pnl")
  getPnl(@CurrentUser() user: AuthenticatedUser, @Query() query: GetPnlQueryDto) {
    return this.financeService.getProfitAndLoss(
      user.organizationId,
      new Date(query.from),
      new Date(query.to),
      query.locationId,
    );
  }

  @Get("expenses")
  listExpenses(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.financeService.listExpenses(user.organizationId, locationId);
  }

  @Post("expenses")
  @Roles(...EXPENSE_MANAGE_ROLES)
  createExpense(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseDto) {
    return this.financeService.createExpense(user, dto);
  }
}
