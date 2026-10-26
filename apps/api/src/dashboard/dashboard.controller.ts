import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrganizationsService } from "../organizations/organizations.service";
import { LocationsService } from "../locations/locations.service";
import { SalesService } from "../sales/sales.service";
import { InventoryService } from "../inventory/inventory.service";
import { DashboardSummaryDto, REVENUE_VIEW_ROLES } from "@bakery-os/shared";
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
  ) {}

  // The whole page is the takings, so it is closed as a whole.
  @Get("summary")
  @Roles(...REVENUE_VIEW_ROLES)
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<DashboardSummaryDto> {
    const [summary, locations, salesSummary, stockLevels] = await Promise.all([
      this.organizationsService.getSummary(user.organizationId),
      this.locationsService.findAllForOrganization(user.organizationId),
      this.salesService.summary(user),
      this.inventoryService.getStockLevels(user),
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
    };
  }
}
