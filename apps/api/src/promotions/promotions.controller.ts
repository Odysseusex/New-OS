import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  PROMOTION_MANAGE_ROLES,
  PromotionCouponPreviewDto,
  PromotionCouponStatus,
  SALE_CREATE_ROLES,
} from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope } from "../common/location-scope";
import { CreatePromotionDto } from "./dto/create-promotion.dto";
import { UpdatePromotionDto } from "./dto/update-promotion.dto";
import { GenerateCouponsDto } from "./dto/generate-coupons.dto";
import { VoidCouponDto } from "./dto/void-coupon.dto";
import { PromotionsService } from "./promotions.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("promotions")
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  @Roles(...PROMOTION_MANAGE_ROLES)
  list(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.promotionsService.list(user, locationId);
  }

  // Reads a coupon's discount rules before the sale is submitted — the till
  // uses this to show the cashier what will happen, without touching the
  // coupon's status. Open to anyone who can sell, not just campaign admins.
  @Get("lookup-coupon")
  @Roles(...SALE_CREATE_ROLES)
  lookupCoupon(
    @CurrentUser() user: AuthenticatedUser,
    @Query("code") code: string,
    @Query("locationId") locationId?: string,
  ): Promise<PromotionCouponPreviewDto> {
    const resolvedLocationId = requireLocationScope(user, locationId);
    return this.promotionsService.previewCoupon(user.organizationId, resolvedLocationId, code);
  }

  @Get(":id")
  @Roles(...PROMOTION_MANAGE_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.promotionsService.findOne(user, id);
  }

  @Post()
  @Roles(...PROMOTION_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePromotionDto) {
    return this.promotionsService.create(user, dto);
  }

  @Patch(":id")
  @Roles(...PROMOTION_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotionsService.update(user, id, dto);
  }

  // `status` is a plain string query param rather than a DTO — a bad value
  // is simply ignored (falls back to the full list) rather than rejected,
  // since this narrows an otherwise-safe read, not a write.
  @Get(":id/coupons")
  @Roles(...PROMOTION_MANAGE_ROLES)
  listCoupons(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Query("status") status?: string) {
    const validStatus = Object.values(PromotionCouponStatus).includes(status as PromotionCouponStatus)
      ? (status as PromotionCouponStatus)
      : undefined;
    return this.promotionsService.listCoupons(user, id, validStatus);
  }

  @Post(":id/coupons")
  @Roles(...PROMOTION_MANAGE_ROLES)
  generateCoupons(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: GenerateCouponsDto,
  ) {
    return this.promotionsService.generateCoupons(user, id, dto.count);
  }

  @Delete(":id/coupons/:couponId")
  @Roles(...PROMOTION_MANAGE_ROLES)
  async voidCoupon(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("couponId") couponId: string,
    @Body() dto: VoidCouponDto,
  ) {
    await this.promotionsService.voidCoupon(user, id, couponId, dto.reason);
    return { voided: true };
  }

  @Get(":id/report")
  @Roles(...PROMOTION_MANAGE_ROLES)
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.promotionsService.report(user, id, new Date(from), new Date(to));
  }
}
