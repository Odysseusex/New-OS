// Marketing promotions (coupon campaigns) — e.g. a paper-coupon test at a
// partner site's till. Deliberately a separate mechanism from the
// MARKDOWN_PERCENT stale-goods discount in sales.ts: a markdown means "this
// is going stale", a promotion means "we are buying foot traffic", and the
// two must never be summed into one figure. SaleItem.promotionId is what
// keeps them apart — see sales.ts's markdownLoss comment.

// Whole tenge, same rounding convention as sales.ts's markdownPrice(): the
// till's keypad has no decimal key. Shared by the server (which computes the
// real discount authoritatively) and the till (which uses the identical
// formula purely to show the cashier a live preview before the sale is
// submitted) so the two can never show a different number for the same line.
export function applyDiscountPercent(fullPrice: number, percent: number): number {
  return Math.round((fullPrice * (100 - percent)) / 100);
}

export interface PromotionRuleDto {
  id: string;
  categoryId: string;
  categoryName: string;
  discountPercent: number;
}

export interface PromotionDto {
  id: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
  // Null = uncapped. Defensive ceiling on total redemptions, in case a paper
  // coupon gets copied.
  maxRedemptions: number | null;
  rules: PromotionRuleDto[];
  // Counted from PromotionCoupon rows, not estimated — cheap enough to
  // always include on the list view.
  couponsIssued: number;
  couponsRedeemed: number;
  createdByName: string;
  createdAt: string;
}

export interface CreatePromotionRuleRequestDto {
  categoryId: string;
  discountPercent: number;
}

export interface CreatePromotionRequestDto {
  name: string;
  // Omit for a network-wide promotion.
  locationId?: string;
  startAt: string;
  endAt: string;
  maxRedemptions?: number;
  rules: CreatePromotionRuleRequestDto[];
}

// Every field optional — this is also what flips `isActive` off to kill a
// promotion mid-test without touching anything else about it.
export interface UpdatePromotionRequestDto {
  name?: string;
  startAt?: string;
  endAt?: string;
  isActive?: boolean;
  maxRedemptions?: number | null;
  rules?: CreatePromotionRuleRequestDto[];
}

export enum PromotionCouponStatus {
  ISSUED = "ISSUED",
  REDEEMED = "REDEEMED",
  VOID = "VOID",
}

export const PROMOTION_COUPON_STATUS_LABELS_RU: Record<PromotionCouponStatus, string> = {
  [PromotionCouponStatus.ISSUED]: "Выдан",
  [PromotionCouponStatus.REDEEMED]: "Использован",
  [PromotionCouponStatus.VOID]: "Аннулирован",
};

export interface PromotionCouponDto {
  id: string;
  code: string;
  status: PromotionCouponStatus;
  redeemedAt: string | null;
  redeemedSaleId: string | null;
  redeemedByName: string | null;
  redeemedLocationName: string | null;
  discountTotal: number | null;
  voidReason: string | null;
  createdAt: string;
}

export interface GeneratePromotionCouponsRequestDto {
  count: number;
}

export interface GeneratePromotionCouponsResponseDto {
  codes: string[];
}

export interface VoidPromotionCouponRequestDto {
  reason?: string;
}

// What the till shows the cashier the moment a code is typed in, BEFORE the
// sale is created — a preview only, it never touches the coupon's status.
// Only the sale itself (CreateSaleRequestDto.couponCode) claims it.
export interface PromotionCouponPreviewDto {
  promotionId: string;
  promotionName: string;
  rules: PromotionRuleDto[];
}

// ── Promotion report ───────────────────────────────────────────────────
//
// Every figure here comes from SaleItem rows tagged with this promotion's
// id, joined against the same cost resolver Finance/AI-центр already use
// (resolveProductUnitCosts) — never a second notion of cost.
export interface PromotionTopProductRowDto {
  productId: string;
  productName: string;
  quantity: number;
  discountTotal: number;
  revenueAfterDiscount: number;
}

export interface PromotionCategoryDiscountRowDto {
  categoryId: string;
  categoryName: string;
  quantity: number;
  discountTotal: number;
}

export interface PromotionReportDto {
  promotionId: string;
  promotionName: string;
  from: string;
  to: string;
  couponsIssued: number;
  couponsRedeemed: number;
  // null when nothing has been issued yet — a ratio of 0/0 is undefined, not
  // 0%.
  conversionPercent: number | null;
  // Distinct redeemed coupons with a linked sale — same count as
  // couponsRedeemed today (a coupon can't redeem without a sale), reported
  // as its own labeled metric because the owner asked for "количество
  // чеков" explicitly.
  receiptsCount: number;
  revenueBeforeDiscount: number;
  discountTotal: number;
  revenueAfterDiscount: number;
  cogs: number;
  grossProfit: number;
  // Whole-sale total (not just the discounted lines) averaged over
  // receiptsCount — a coupon is meant to move the WHOLE basket, not only
  // the discounted items in it.
  averageTicket: number | null;
  topProducts: PromotionTopProductRowDto[];
  discountByCategory: PromotionCategoryDiscountRowDto[];
}
