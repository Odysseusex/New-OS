import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrganizationsService } from "../organizations/organizations.service";
import { LocationsService } from "../locations/locations.service";
import { SalesService } from "../sales/sales.service";
import { InventoryService } from "../inventory/inventory.service";
import { DashboardFinanceDto, DashboardSummaryDto, DEBT_VIEW_ROLES, FINANCE_VIEW_ROLES, REVENUE_VIEW_ROLES } from "@bakery-os/shared";
import { DashboardFinanceService } from "./dashboard-finance.service";
import { resolveLocationScope } from "../common/location-scope";
import { DebtsService } from "../debts/debts.service";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(
    private organizationsService: OrganizationsService,
    private locationsService: LocationsService,
    private salesService: SalesService,
    private inventoryService: InventoryService,
    private debtsService: DebtsService,
    private financeFigures: DashboardFinanceService,
  ) {}

  // The whole page is the takings, so it is closed as a whole.
  @Get("summary")
  @Roles(...REVENUE_VIEW_ROLES)
  async summary(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string): Promise<DashboardSummaryDto> {
    const [summary, locations, salesSummary, stockLevels, receivables] = await Promise.all([
      this.organizationsService.getSummary(user.organizationId),
      this.locationsService.findAllForOrganization(user.organizationId),
      this.salesService.summary(user, locationId || undefined),
      this.inventoryService.getStockLevels(user, locationId || undefined),
      DEBT_VIEW_ROLES.includes(user.role) ? this.debtsService.receivables(user.organizationId) : Promise.resolve(null),
    ]);

    return {
      organizationName: summary.organization.name,
      locationsCount: summary.locationsCount,
      regionsCount: summary.regionsCount,
      usersCount: summary.usersCount,
      locations,
      todayRevenue: salesSummary.todayRevenue,
      last7DaysRevenue: salesSummary.last7DaysRevenue,
      lowStockCount: stockLevels.filter((s) => s.isLow).length,
      receivables: receivables ? { total: receivables.total, overdue: receivables.overdue } : null,
    };
  }

  // Gross profit, money, debts, the shops' shelf and the top products (ТЗ §8.4).
  @Get("finance")
  @Roles(...FINANCE_VIEW_ROLES)
  finance(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string,
    @Query("directionId") directionId?: string,
  ): Promise<DashboardFinanceDto> {
    return this.financeFigures.figures(user.organizationId, resolveLocationScope(user, locationId || undefined), new Date(), directionId || undefined);
  }
}
