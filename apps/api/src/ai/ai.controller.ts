import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AI_INSIGHTS_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { AiAnalyticsService } from "./ai-analytics.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...AI_INSIGHTS_VIEW_ROLES)
@Controller("ai")
export class AiController {
  constructor(private aiAnalyticsService: AiAnalyticsService) {}

  @Get("summary")
  getSummary(@CurrentUser() user: AuthenticatedUser, @Query("days") days?: string) {
    return this.aiAnalyticsService.getExecutiveSummary(user, days ? Number(days) : undefined);
  }

  @Get("locations")
  getLocationDeviations(@CurrentUser() user: AuthenticatedUser, @Query("days") days?: string) {
    return this.aiAnalyticsService.computeLocationDeviations(user, days ? Number(days) : undefined);
  }

  @Get("insights")
  getInsights(@CurrentUser() user: AuthenticatedUser) {
    return this.aiAnalyticsService.getInsights(user);
  }

  @Post("insights/:key/dismiss")
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param("key") key: string) {
    return this.aiAnalyticsService.dismiss(user, key);
  }

  @Post("insights/dismiss-all")
  dismissAll(@CurrentUser() user: AuthenticatedUser) {
    return this.aiAnalyticsService.dismissAll(user);
  }
}
