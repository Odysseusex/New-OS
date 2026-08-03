import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrganizationsService } from "../organizations/organizations.service";
import { LocationsService } from "../locations/locations.service";
import { SalesService } from "../sales/sales.service";
import { InventoryService } from "../inventory/inventory.service";
import { DashboardSummaryDto } from "@bakery-os/shared";

@UseGuards(JwtAuthGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(
    private organizationsService: OrganizationsService,
    private locationsService: LocationsService,
    private salesService: SalesService,
    private inventoryService: InventoryService,
  ) {}

  @Get("summary")
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
