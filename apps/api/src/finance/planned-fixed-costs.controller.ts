import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { FINANCE_VIEW_ROLES, PLANNED_FIXED_COST_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { PlannedFixedCostsService } from "./planned-fixed-costs.service";
import { CreatePlannedFixedCostDto } from "./dto/create-planned-fixed-cost.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance/planned-fixed-costs")
export class PlannedFixedCostsController {
  constructor(private plannedFixedCostsService: PlannedFixedCostsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("includeHistory") includeHistory?: string) {
    return this.plannedFixedCostsService.list(user.organizationId, includeHistory === "true");
  }

  @Post()
  @Roles(...PLANNED_FIXED_COST_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlannedFixedCostDto) {
    return this.plannedFixedCostsService.create(user, dto);
  }

  // Ends the plan without deleting it — the history row stays intact.
  @Post(":id/close")
  @Roles(...PLANNED_FIXED_COST_MANAGE_ROLES)
  close(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.plannedFixedCostsService.close(user, id);
  }
}
