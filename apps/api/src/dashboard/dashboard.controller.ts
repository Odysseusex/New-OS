import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrganizationsService } from "../organizations/organizations.service";
import { LocationsService } from "../locations/locations.service";
import { DashboardSummaryDto } from "@bakery-os/shared";

@UseGuards(JwtAuthGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(
    private organizationsService: OrganizationsService,
    private locationsService: LocationsService,
  ) {}

  @Get("summary")
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<DashboardSummaryDto> {
    const [summary, locations] = await Promise.all([
      this.organizationsService.getSummary(user.organizationId),
      this.locationsService.findAllForOrganization(user.organizationId),
    ]);

    return {
      organizationName: summary.organization.name,
      locationsCount: summary.locationsCount,
      regionsCount: summary.regionsCount,
      usersCount: summary.usersCount,
      locations,
    };
  }
}
