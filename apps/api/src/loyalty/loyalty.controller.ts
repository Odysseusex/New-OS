import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LOYALTY_ADMIN_ROLES, LOYALTY_MANAGE_ROLES, LOYALTY_TILL_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { LoyaltyService } from "./loyalty.service";
import { LoyaltyPointsService } from "./loyalty-points.service";
import {
  AdjustLoyaltyPointsDto,
  UpdateLoyaltySettingsDto,
  LoyaltyImportApplyRequestDto,
  LoyaltyImportPreviewRequestDto,
  MergeLoyaltyMembersDto,
  RecordLoyaltyConsentDto,
  RegisterLoyaltyMemberDto,
  UpdateLoyaltyMemberDto,
} from "./dto/loyalty.dto";

// Unlike most of the app, nothing here is open to every role by default: it is
// a list of people's phone numbers.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...LOYALTY_TILL_ROLES)
@Controller("loyalty/members")
export class LoyaltyController {
  constructor(
    private loyaltyService: LoyaltyService,
    private pointsService: LoyaltyPointsService,
  ) {}

  @Get("lookup")
  lookup(@CurrentUser() user: AuthenticatedUser, @Query("phone") phone: string) {
    return this.loyaltyService.lookup(user.organizationId, phone);
  }

  @Get()
  @Roles(...LOYALTY_MANAGE_ROLES)
  list(@CurrentUser() user: AuthenticatedUser, @Query("q") q?: string, @Query("status") status?: string) {
    return this.loyaltyService.list(user.organizationId, { q, status });
  }

  @Post()
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterLoyaltyMemberDto) {
    return this.loyaltyService.register(user, dto);
  }

  @Post("merge")
  @Roles(...LOYALTY_ADMIN_ROLES)
  merge(@CurrentUser() user: AuthenticatedUser, @Body() dto: MergeLoyaltyMembersDto) {
    return this.loyaltyService.merge(user, dto);
  }

  @Post("import/preview")
  @Roles(...LOYALTY_ADMIN_ROLES)
  previewImport(@CurrentUser() user: AuthenticatedUser, @Body() dto: LoyaltyImportPreviewRequestDto) {
    return this.loyaltyService.previewImport(user.organizationId, dto.rows);
  }

  @Post("import/apply")
  @Roles(...LOYALTY_ADMIN_ROLES)
  applyImport(@CurrentUser() user: AuthenticatedUser, @Body() dto: LoyaltyImportApplyRequestDto) {
    return this.loyaltyService.applyImport(user, dto);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.loyaltyService.findOne(user.organizationId, id);
  }

  @Patch(":id")
  @Roles(...LOYALTY_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateLoyaltyMemberDto) {
    return this.loyaltyService.update(user, id, dto);
  }

  @Post(":id/consents")
  recordConsent(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: RecordLoyaltyConsentDto) {
    return this.loyaltyService.recordConsent(user, id, dto);
  }

  @Post(":id/points/adjust")
  @Roles(...LOYALTY_ADMIN_ROLES)
  async adjustPoints(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: AdjustLoyaltyPointsDto) {
    return { balance: await this.pointsService.adjust(user, id, dto) };
  }
}

// Programme-wide: settings (the till reads them to know the limits) and the summary.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...LOYALTY_TILL_ROLES)
@Controller("loyalty")
export class LoyaltyProgramController {
  constructor(private pointsService: LoyaltyPointsService) {}

  @Get("settings")
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.pointsService.getSettings(user.organizationId);
  }

  @Patch("settings")
  @Roles(...LOYALTY_ADMIN_ROLES)
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateLoyaltySettingsDto) {
    return this.pointsService.updateSettings(user, dto);
  }

  @Get("summary")
  @Roles(...LOYALTY_MANAGE_ROLES)
  summary(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException("Неверный период");
    return this.pointsService.summary(user.organizationId, start, end);
  }
}
