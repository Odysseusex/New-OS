import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { BusinessDirection, CashFlowDto, DIRECTION_ALLOCATION_ROLES, EXPENSE_MANAGE_ROLES, FINANCE_VIEW_ROLES, ProfitAndLossDto } from "@bakery-os/shared";
import { DirectionAllocationBodyDto } from "./dto/direction-allocation.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { FinanceService } from "./finance.service";
import { FinancialPeriodsService } from "./periods/periods.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { RecordExpensePaymentDto } from "./dto/record-expense-payment.dto";
import { GetPnlQueryDto } from "./dto/get-pnl-query.dto";
import { CashFlowByDateQueryDto, CashFlowDateOperationsQueryDto, CashFlowMonthlyQueryDto, CashFlowOperationsQueryDto } from "./dto/cash-flow-monthly-query.dto";
import { GetProductPnlQueryDto } from "./dto/get-product-pnl-query.dto";

const scopeOf = (q: { locationId?: string; accountId?: string; direction?: BusinessDirection }) => ({
  locationId: q.locationId || undefined,
  accountId: q.accountId || undefined,
  direction: q.direction || undefined,
});

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance")
export class FinanceController {
  constructor(
    private financeService: FinanceService,
    private periods: FinancialPeriodsService,
  ) {}

  @Get("inventory-valuation")
  getInventoryValuation(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.getInventoryValuation(user.organizationId);
  }

  @Get("dashboard")
  getDashboard(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.financeService.getDashboard(
      user.organizationId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get("pnl")
  async getPnl(@CurrentUser() user: AuthenticatedUser, @Query() query: GetPnlQueryDto) {
    // A whole closed month is served from its frozen snapshot, so what the
    // owner saw when the month closed cannot drift with later data.
    if (!query.locationId) {
      const month = this.periods.matchWholeMonth(new Date(query.from), new Date(query.to));
      const frozen = month && (await this.periods.frozenSection<ProfitAndLossDto>(user.organizationId, month.year, month.month, "pnl"));
      if (frozen) return { ...frozen.data, frozen: frozen.info };
    }
    return this.financeService.getProfitAndLoss(
      user.organizationId,
      new Date(query.from),
      new Date(query.to),
      query.locationId,
    );
  }

  // ОПиУ with a column per point plus «Итого». Always live.
  @Get("pnl/locations")
  getPnlByLocation(@CurrentUser() user: AuthenticatedUser, @Query() query: GetPnlQueryDto) {
    return this.financeService.getPnlByLocation(user.organizationId, new Date(query.from), new Date(query.to));
  }

  // Прибыль по направлениям: опт / розница / заказы. Always live.
  @Get("pnl/directions")
  getPnlByDirection(@CurrentUser() user: AuthenticatedUser, @Query() query: GetPnlQueryDto) {
    return this.financeService.getPnlByDirection(user.organizationId, new Date(query.from), new Date(query.to), query.locationId);
  }

  // How common costs are shared between directions: revenue / gross profit / stated %.
  @Put("pnl/directions/allocation")
  @Roles(...DIRECTION_ALLOCATION_ROLES)
  setDirectionAllocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: DirectionAllocationBodyDto) {
    return this.financeService.setDirectionAllocation(user.organizationId, user.id, { base: dto.base, shares: (dto.shares ?? null) as never });
  }

  // One row of «Финансовый результат по товарам», opened up. Always live:
  // sale lines carry their cost stamp, so it agrees with a frozen month too.
  @Get("pnl/product")
  getProductPnl(@CurrentUser() user: AuthenticatedUser, @Query() query: GetProductPnlQueryDto) {
    return this.financeService.getProductPnlDetail(
      user.organizationId,
      query.productId,
      new Date(query.from),
      new Date(query.to),
      query.locationId,
    );
  }

  // ДДС over a period. Gated by the controller's own class-level roles, same
  // as every other finance figure — cash movements are not shop-floor data.
  @Get("cash-flow")
  async getCashFlow(@CurrentUser() user: AuthenticatedUser, @Query() query: GetPnlQueryDto) {
    const scope = scopeOf(query);
    // The frozen snapshot is the whole network's; a point, account or direction is read live.
    const month = !scope.locationId && !scope.accountId && !scope.direction && this.periods.matchWholeMonth(new Date(query.from), new Date(query.to));
    const frozen = month && (await this.periods.frozenSection<CashFlowDto>(user.organizationId, month.year, month.month, "cashFlow"));
    if (frozen) return { ...frozen.data, frozen: frozen.info };
    return this.financeService.getCashFlow(user.organizationId, new Date(query.from), new Date(query.to), scope);
  }

  // ДДС with a column per month: from/to are months, "YYYY-MM".
  @Get("cash-flow/monthly")
  getCashFlowMonthly(@CurrentUser() user: AuthenticatedUser, @Query() query: CashFlowMonthlyQueryDto) {
    return this.financeService.getCashFlowMonthly(user.organizationId, query.fromMonth, query.toMonth, scopeOf(query));
  }

  // ДДС with a column per week or per day: from/to are dates, "YYYY-MM-DD".
  @Get("cash-flow/by-date")
  getCashFlowByDate(@CurrentUser() user: AuthenticatedUser, @Query() query: CashFlowByDateQueryDto) {
    return this.financeService.getCashFlowByDate(user.organizationId, query.granularity, query.fromDate, query.toDate, scopeOf(query));
  }

  @Get("cash-flow/operations-by-date")
  getCashFlowOperationsByDate(@CurrentUser() user: AuthenticatedUser, @Query() query: CashFlowDateOperationsQueryDto) {
    return this.financeService.getCashFlowOperationsByDate(user.organizationId, query.section, query.label, query.fromDate, query.toDate, scopeOf(query));
  }

  // The movements behind one cell of that report.
  @Get("cash-flow/operations")
  getCashFlowOperations(@CurrentUser() user: AuthenticatedUser, @Query() query: CashFlowOperationsQueryDto) {
    return this.financeService.getCashFlowOperations(user.organizationId, query.section, query.label, query.fromMonth, query.toMonth, scopeOf(query));
  }

  @Get("break-even")
  getBreakEven(@CurrentUser() user: AuthenticatedUser, @Query() query: GetPnlQueryDto) {
    return this.financeService.getBreakEven(
      user.organizationId,
      new Date(query.from),
      new Date(query.to),
      query.locationId,
    );
  }

  @Get("break-even/planned")
  getPlannedBreakEven(@CurrentUser() user: AuthenticatedUser, @Query() query: GetPnlQueryDto) {
    return this.financeService.getPlannedBreakEven(
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

  @Post("expenses/:id/confirm")
  @Roles(...EXPENSE_MANAGE_ROLES)
  confirmExpense(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.financeService.confirmExpense(user.organizationId, id, user.id);
  }

  @Post("expenses/:id/cancel")
  @Roles(...EXPENSE_MANAGE_ROLES)
  cancelExpense(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.financeService.cancelExpense(user.organizationId, id, user.id);
  }

  @Post("expenses/:id/payments")
  @Roles(...EXPENSE_MANAGE_ROLES)
  recordExpensePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: RecordExpensePaymentDto,
  ) {
    return this.financeService.recordExpensePayment(user, id, dto);
  }
}
