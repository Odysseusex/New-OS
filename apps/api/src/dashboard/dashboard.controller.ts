import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrganizationsService } from "../organizations/organizations.service";
import { LocationsService } from "../locations/locations.service";
import { SalesService } from "../sales/sales.service";
import { InventoryService } from "../inventory/inventory.service";
import { DashboardSummaryDto, DEBT_VIEW_ROLES, REVENUE_VIEW_ROLES } from "@bakery-os/shared";
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
  ) {}

  // The whole page is the takings, so it is closed as a whole.
  @Get("summary")
  @Roles(...REVENUE_VIEW_ROLES)
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<DashboardSummaryDto> {
    const [summary, locations, salesSummary, stockLevels, receivables] = await Promise.all([
      this.organizationsService.getSummary(user.organizationId),
      this.locationsService.findAllForOrganization(user.organizationId),
      this.salesService.summary(user),
      this.inventoryService.getStockLevels(user),
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
}
