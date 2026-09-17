import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  AI_INSIGHTS_VIEW_ROLES,
  BUSINESS_CONTEXT_MODULES,
  type BusinessContextModule,
} from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { AiAnalyticsService } from "./ai-analytics.service";
import { BusinessContextService } from "./business-context.service";
import { GetBusinessContextQueryDto } from "./dto/get-business-context-query.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...AI_INSIGHTS_VIEW_ROLES)
@Controller("ai")
export class AiController {
  constructor(
    private aiAnalyticsService: AiAnalyticsService,
    private businessContextService: BusinessContextService,
  ) {}

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

  // The provider-agnostic business context — the JSON an external AI reads.
  // Today it is rendered to Markdown in the browser and pasted into ChatGPT;
  // a future OpenAI/Claude integration would post this same payload without
  // anything here changing.
  //
  // Gated by the controller's class-level @Roles(AI_INSIGHTS_VIEW_ROLES),
  // i.e. ORG_WIDE_ROLES — a cashier cannot pull the network's finances out
  // of the building through this route any more than through the AI Center
  // it belongs to.
  @Get("business-context")
  getBusinessContext(@CurrentUser() user: AuthenticatedUser, @Query() query: GetBusinessContextQueryDto) {
    return this.businessContextService.build(user, {
      from: new Date(query.from),
      to: new Date(query.to),
      level: query.level ?? "business",
      locationId: query.locationId,
      // Comma-separated in the query string, validated against the known
      // module list so an unknown name cannot silently produce a section
      // nobody asked for — or silently drop one they did.
      modules: query.modules
        ?.split(",")
        .map((m) => m.trim())
        .filter((m): m is BusinessContextModule =>
          (BUSINESS_CONTEXT_MODULES as readonly string[]).includes(m),
        ),
    });
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
