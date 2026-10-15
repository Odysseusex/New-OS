import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LOYALTY_ADMIN_ROLES, LOYALTY_MANAGE_ROLES, LOYALTY_TILL_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { LoyaltyService } from "./loyalty.service";
import {
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
  constructor(private loyaltyService: LoyaltyService) {}

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
}
