import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PromotionCouponStatus as PrismaPromotionCouponStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  PromotionCouponDto,
  PromotionCouponPreviewDto,
  PromotionCouponStatus,
  PromotionDto,
  PromotionReportDto,
  PromotionCategoryDiscountRowDto,
  PromotionTopProductRowDto,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { resolveLocationScope } from "../common/location-scope";
import { resolveProductUnitCosts } from "../common/product-costs";
import { CreatePromotionDto } from "./dto/create-promotion.dto";
import { UpdatePromotionDto } from "./dto/update-promotion.dto";
import { generateCouponCode } from "./promotions.constants";

const round2 = (value: number): number => Number(value.toFixed(2));

const PROMOTION_INCLUDE = {
  location: true,
  createdBy: true,
  rules: { include: { category: true } },
};

type PromotionWithRelations = Prisma.PromotionGetPayload<{ include: typeof PROMOTION_INCLUDE }> & {
  _count?: { coupons: number };
};

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  // Visible to a location-pinned manager whenever it's network-wide OR
  // theirs specifically — a promotion scoped to another store is simply not
  // this manager's business, same principle as every other location-scoped
  // resource in the app.
  async list(user: AuthenticatedUser, requestedLocationId?: string): Promise<PromotionDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const [promotions, issuedCounts, redeemedCounts] = await Promise.all([
      this.prisma.promotion.findMany({
        where: {
          organizationId: user.organizationId,
          ...(locationId ? { OR: [{ locationId: null }, { locationId }] } : {}),
        },
        include: PROMOTION_INCLUDE,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.promotionCoupon.groupBy({
        by: ["promotionId"],
        where: { organizationId: user.organizationId },
        _count: { _all: true },
      }),
      this.prisma.promotionCoupon.groupBy({
        by: ["promotionId"],
        where: { organizationId: user.organizationId, status: PrismaPromotionCouponStatus.REDEEMED },
        _count: { _all: true },
      }),
    ]);

    const issuedByPromotion = new Map(issuedCounts.map((c) => [c.promotionId, c._count._all]));
    const redeemedByPromotion = new Map(redeemedCounts.map((c) => [c.promotionId, c._count._all]));

    return promotions.map((p) =>
      this.toDto(p, issuedByPromotion.get(p.id) ?? 0, redeemedByPromotion.get(p.id) ?? 0),
    );
  }

  async findOne(user: AuthenticatedUser, promotionId: string): Promise<PromotionDto> {
    const promotion = await this.getOwned(user.organizationId, promotionId);
    resolveLocationScope(user, promotion.locationId ?? undefined);

    const [issued, redeemed] = await Promise.all([
      this.prisma.promotionCoupon.count({ where: { promotionId } }),
      this.prisma.promotionCoupon.count({
        where: { promotionId, status: PrismaPromotionCouponStatus.REDEEMED },
      }),
    ]);
    return this.toDto(promotion, issued, redeemed);
  }

  async create(user: AuthenticatedUser, dto: CreatePromotionDto): Promise<PromotionDto> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) {
      throw new BadRequestException("Дата окончания акции должна быть позже даты начала");
    }

    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, organizationId: user.organizationId },
      });
      if (!location) throw new NotFoundException("Точка не найдена");
    }

    await this.assertCategoriesExist(
      user.organizationId,
      dto.rules.map((r) => r.categoryId),
    );

    const promotion = await this.prisma.promotion.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        locationId: dto.locationId ?? null,
        startAt,
        endAt,
        maxRedemptions: dto.maxRedemptions ?? null,
        createdById: user.id,
        rules: { create: dto.rules.map((r) => ({ categoryId: r.categoryId, discountPercent: r.discountPercent })) },
      },
      include: PROMOTION_INCLUDE,
    });

    return this.toDto(promotion, 0, 0);
  }

  // Rules, when sent, are replaced wholesale rather than merged — simpler
  // and matches how the admin screen edits them (the whole rule list is one
  // form, not a per-row API). `isActive` is the whole "toggle off without a
  // code change" requirement.
  async update(user: AuthenticatedUser, promotionId: string, dto: UpdatePromotionDto): Promise<PromotionDto> {
    const existing = await this.getOwned(user.organizationId, promotionId);
    resolveLocationScope(user, existing.locationId ?? undefined);

    const startAt = dto.startAt ? new Date(dto.startAt) : existing.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : existing.endAt;
    if (endAt <= startAt) {
      throw new BadRequestException("Дата окончания акции должна быть позже даты начала");
    }

    if (dto.rules) {
      await this.assertCategoriesExist(
        user.organizationId,
        dto.rules.map((r) => r.categoryId),
      );
    }

    const promotion = await this.prisma.$transaction(async (tx) => {
      if (dto.rules) {
        await tx.promotionRule.deleteMany({ where: { promotionId } });
        await tx.promotionRule.createMany({
          data: dto.rules.map((r) => ({ promotionId, categoryId: r.categoryId, discountPercent: r.discountPercent })),
        });
      }
      return tx.promotion.update({
        where: { id: promotionId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.startAt !== undefined ? { startAt } : {}),
          ...(dto.endAt !== undefined ? { endAt } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.maxRedemptions !== undefined ? { maxRedemptions: dto.maxRedemptions } : {}),
        },
        include: PROMOTION_INCLUDE,
      });
    });

    const [issued, redeemed] = await Promise.all([
      this.prisma.promotionCoupon.count({ where: { promotionId } }),
      this.prisma.promotionCoupon.count({
        where: { promotionId, status: PrismaPromotionCouponStatus.REDEEMED },
      }),
    ]);
    return this.toDto(promotion, issued, redeemed);
  }

  // `status` narrows to one lifecycle stage — chiefly ISSUED, for a caller
  // building a print batch that must never include an already-redeemed or
  // voided code. Passing nothing keeps the full history, same as before.
  async listCoupons(
    user: AuthenticatedUser,
    promotionId: string,
    status?: PromotionCouponStatus,
  ): Promise<PromotionCouponDto[]> {
    const promotion = await this.getOwned(user.organizationId, promotionId);
    resolveLocationScope(user, promotion.locationId ?? undefined);

    const coupons = await this.prisma.promotionCoupon.findMany({
      where: { promotionId, ...(status ? { status: status as PrismaPromotionCouponStatus } : {}) },
      include: { redeemedBy: true, redeemedLocation: true },
      orderBy: { createdAt: "asc" },
    });
    return coupons.map((c) => this.toCouponDto(c));
  }

  // One bulk insert per call rather than a loop of single-row creates: at a
  // few thousand codes, thousands of sequential round trips in one HTTP
  // request is a real timeout/network-drop risk (this is meant to run from
  // a laptop on a supermarket's wifi), and a request that dies partway used
  // to leave already-created rows silently invisible to the caller — never
  // returned, never printed, but still counting toward "issued" in every
  // report forever. createManyAndReturn makes each attempt atomic-ish in
  // effect: we always learn exactly which of our candidates actually
  // landed, and top up only the shortfall.
  //
  // Every code minted by one call shares `batchLabel` (this call's own
  // timestamp) — the admin screen groups by it to show "print runs" and to
  // let a re-download pull just one run's still-ISSUED codes.
  async generateCoupons(
    user: AuthenticatedUser,
    promotionId: string,
    count: number,
  ): Promise<{ codes: string[]; batchLabel: string }> {
    const promotion = await this.getOwned(user.organizationId, promotionId);
    resolveLocationScope(user, promotion.locationId ?? undefined);

    const batchLabel = new Date().toISOString();
    const allCodes: string[] = [];
    // Codes already tried in THIS call, successful or not — never generate
    // the same random value twice within one batch, on top of the alphabet
    // already making a collision astronomically unlikely.
    const attempted = new Set<string>();
    const MAX_ROUNDS = 10;

    for (let round = 0; round < MAX_ROUNDS && allCodes.length < count; round++) {
      const need = count - allCodes.length;
      const candidates: string[] = [];
      while (candidates.length < need) {
        const code = generateCouponCode();
        if (attempted.has(code)) continue;
        attempted.add(code);
        candidates.push(code);
      }

      const inserted = await this.prisma.promotionCoupon.createManyAndReturn({
        data: candidates.map((code) => ({ organizationId: user.organizationId, promotionId, code, batchLabel })),
        skipDuplicates: true,
        select: { code: true },
      });
      allCodes.push(...inserted.map((r) => r.code));
    }

    if (allCodes.length < count) {
      throw new BadRequestException("Не удалось сгенерировать уникальные коды купонов — повторите попытку");
    }
    return { codes: allCodes, batchLabel };
  }

  // Only an ISSUED coupon can be voided — a REDEEMED one already represents
  // real money and goods that changed hands, and undoing that is what
  // SaleReturn is for, not this.
  async voidCoupon(user: AuthenticatedUser, promotionId: string, couponId: string, reason?: string): Promise<void> {
    const promotion = await this.getOwned(user.organizationId, promotionId);
    resolveLocationScope(user, promotion.locationId ?? undefined);

    const coupon = await this.prisma.promotionCoupon.findFirst({ where: { id: couponId, promotionId } });
    if (!coupon) throw new NotFoundException("Купон не найден");
    if (coupon.status !== PrismaPromotionCouponStatus.ISSUED) {
      throw new BadRequestException("Можно аннулировать только ещё не использованный купон");
    }

    await this.prisma.promotionCoupon.update({
      where: { id: couponId },
      data: { status: PrismaPromotionCouponStatus.VOID, voidReason: reason ?? null },
    });
  }

  // What the till shows the moment a code is typed in — a read-only preview,
  // never changes the coupon's status. Open to anyone who can sell (not
  // gated to PROMOTION_MANAGE_ROLES), because applying an already-issued
  // coupon is part of ringing up a sale, not campaign administration.
  async previewCoupon(organizationId: string, locationId: string, code: string): Promise<PromotionCouponPreviewDto> {
    const { promotion } = await this.resolveActiveCoupon(organizationId, locationId, code);
    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      rules: promotion.rules.map((r) => ({
        id: r.id,
        categoryId: r.categoryId,
        categoryName: r.category.name,
        discountPercent: r.discountPercent,
      })),
    };
  }

  // Looks up a coupon by its code and validates everything about it — status,
  // the promotion's own on/off switch, its date window, its location scope
  // and its redemption cap. Shared by the POS preview above and
  // SalesService.create(), so the two can never disagree about what makes a
  // coupon valid, and a cashier sees the exact same rejection at preview
  // time that a submitted sale would hit.
  async resolveActiveCoupon(organizationId: string, locationId: string, code: string) {
    const coupon = await this.prisma.promotionCoupon.findFirst({
      where: { organizationId, code: code.trim().toUpperCase() },
      include: { promotion: { include: { rules: { include: { category: true } } } } },
    });
    if (!coupon) throw new BadRequestException("Купон не найден");
    if (coupon.status === PrismaPromotionCouponStatus.REDEEMED) {
      throw new BadRequestException("Купон уже использован");
    }
    if (coupon.status === PrismaPromotionCouponStatus.VOID) {
      throw new BadRequestException("Купон аннулирован");
    }

    const { promotion } = coupon;
    if (!promotion.isActive) throw new BadRequestException("Акция отключена");
    const now = new Date();
    if (now < promotion.startAt || now > promotion.endAt) {
      throw new BadRequestException("Купон вне срока действия акции");
    }
    if (promotion.locationId && promotion.locationId !== locationId) {
      throw new BadRequestException("Купон недействителен в этой точке");
    }
    if (promotion.maxRedemptions !== null) {
      const redeemedCount = await this.prisma.promotionCoupon.count({
        where: { promotionId: promotion.id, status: PrismaPromotionCouponStatus.REDEEMED },
      });
      if (redeemedCount >= promotion.maxRedemptions) {
        throw new BadRequestException("Достигнут лимит использований акции");
      }
    }

    return { coupon, promotion };
  }

  // "Что мы получили от этой акции": issued/used/conversion plus the money
  // side, read entirely off SaleItem rows tagged with this promotion's id.
  // Cost comes from the same resolver Finance/AI-центр use — see
  // resolveProductUnitCosts's own comment for why that matters.
  async report(user: AuthenticatedUser, promotionId: string, from: Date, to: Date): Promise<PromotionReportDto> {
    const promotion = await this.getOwned(user.organizationId, promotionId);
    resolveLocationScope(user, promotion.locationId ?? undefined);

    const [issuedTotal, redeemedTotal, taggedItems, unitCosts] = await Promise.all([
      this.prisma.promotionCoupon.count({ where: { promotionId } }),
      this.prisma.promotionCoupon.count({
        where: { promotionId, status: PrismaPromotionCouponStatus.REDEEMED },
      }),
      this.prisma.saleItem.findMany({
        where: {
          promotionId,
          sale: { soldAt: { gte: from, lte: to } },
        },
        include: { product: { include: { categoryRef: true } }, sale: true },
      }),
      resolveProductUnitCosts(this.prisma, user.organizationId),
    ]);

    const productAcc = new Map<string, PromotionTopProductRowDto>();
    const categoryAcc = new Map<string, PromotionCategoryDiscountRowDto>();
    const saleIds = new Set<string>();
    let revenueBeforeDiscount = 0;
    let discountTotal = 0;
    let revenueAfterDiscount = 0;
    let cogs = 0;

    for (const item of taggedItems) {
      const quantity = item.quantity.toNumber();
      const unitPrice = item.unitPrice.toNumber();
      const full = item.fullUnitPrice?.toNumber() ?? unitPrice;
      const lineDiscount = (full - unitPrice) * quantity;
      const lineRevenueAfter = unitPrice * quantity;

      revenueBeforeDiscount += full * quantity;
      discountTotal += lineDiscount;
      revenueAfterDiscount += lineRevenueAfter;
      const unitCost = unitCosts.get(item.productId);
      if (unitCost !== undefined) cogs += unitCost * quantity;
      saleIds.add(item.saleId);

      const productRow = productAcc.get(item.productId) ?? {
        productId: item.productId,
        productName: item.product.name,
        quantity: 0,
        discountTotal: 0,
        revenueAfterDiscount: 0,
      };
      productRow.quantity += quantity;
      productRow.discountTotal += lineDiscount;
      productRow.revenueAfterDiscount += lineRevenueAfter;
      productAcc.set(item.productId, productRow);

      const categoryId = item.product.categoryId ?? "__uncategorized__";
      const categoryRow = categoryAcc.get(categoryId) ?? {
        categoryId,
        categoryName: item.product.categoryRef?.name ?? "Без категории",
        quantity: 0,
        discountTotal: 0,
      };
      categoryRow.quantity += quantity;
      categoryRow.discountTotal += lineDiscount;
      categoryAcc.set(categoryId, categoryRow);
    }

    // Average ticket is the WHOLE sale total for every receipt that carried
    // this coupon, not just its discounted lines — a coupon is meant to
    // move the whole basket, and only counting the discounted part would
    // understate exactly the effect being measured.
    const sales = saleIds.size
      ? await this.prisma.sale.findMany({ where: { id: { in: Array.from(saleIds) } }, select: { totalAmount: true } })
      : [];
    const wholeSaleTotal = sales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0);

    return {
      promotionId,
      promotionName: promotion.name,
      from: from.toISOString(),
      to: to.toISOString(),
      couponsIssued: issuedTotal,
      couponsRedeemed: redeemedTotal,
      conversionPercent: issuedTotal > 0 ? round2((redeemedTotal / issuedTotal) * 100) : null,
      receiptsCount: saleIds.size,
      revenueBeforeDiscount: round2(revenueBeforeDiscount),
      discountTotal: round2(discountTotal),
      revenueAfterDiscount: round2(revenueAfterDiscount),
      cogs: round2(cogs),
      grossProfit: round2(revenueAfterDiscount - cogs),
      averageTicket: saleIds.size > 0 ? round2(wholeSaleTotal / saleIds.size) : null,
      topProducts: Array.from(productAcc.values())
        .map((r) => ({ ...r, discountTotal: round2(r.discountTotal), revenueAfterDiscount: round2(r.revenueAfterDiscount) }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 20),
      discountByCategory: Array.from(categoryAcc.values())
        .map((r) => ({ ...r, discountTotal: round2(r.discountTotal) }))
        .sort((a, b) => b.discountTotal - a.discountTotal),
    };
  }

  private async getOwned(organizationId: string, promotionId: string): Promise<PromotionWithRelations> {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id: promotionId, organizationId },
      include: PROMOTION_INCLUDE,
    });
    if (!promotion) throw new NotFoundException("Акция не найдена");
    return promotion;
  }

  private async assertCategoriesExist(organizationId: string, categoryIds: string[]): Promise<void> {
    const unique = Array.from(new Set(categoryIds));
    const found = await this.prisma.category.count({ where: { id: { in: unique }, organizationId } });
    if (found !== unique.length) {
      throw new BadRequestException("Одна или несколько категорий не найдены");
    }
  }

  private toDto(promotion: PromotionWithRelations, couponsIssued: number, couponsRedeemed: number): PromotionDto {
    return {
      id: promotion.id,
      name: promotion.name,
      locationId: promotion.locationId,
      locationName: promotion.location?.name ?? null,
      startAt: promotion.startAt.toISOString(),
      endAt: promotion.endAt.toISOString(),
      isActive: promotion.isActive,
      maxRedemptions: promotion.maxRedemptions,
      rules: promotion.rules.map((r) => ({
        id: r.id,
        categoryId: r.categoryId,
        categoryName: r.category.name,
        discountPercent: r.discountPercent,
      })),
      couponsIssued,
      couponsRedeemed,
      createdByName: promotion.createdBy.fullName,
      createdAt: promotion.createdAt.toISOString(),
    };
  }

  private toCouponDto(coupon: {
    id: string;
    code: string;
    status: string;
    batchLabel: string | null;
    redeemedAt: Date | null;
    redeemedSaleId: string | null;
    redeemedBy: { fullName: string } | null;
    redeemedLocation: { name: string } | null;
    discountTotal: { toNumber: () => number } | null;
    voidReason: string | null;
    createdAt: Date;
  }): PromotionCouponDto {
    return {
      id: coupon.id,
      code: coupon.code,
      status: coupon.status as PromotionCouponStatus,
      batchLabel: coupon.batchLabel,
      redeemedAt: coupon.redeemedAt ? coupon.redeemedAt.toISOString() : null,
      redeemedSaleId: coupon.redeemedSaleId,
      redeemedByName: coupon.redeemedBy?.fullName ?? null,
      redeemedLocationName: coupon.redeemedLocation?.name ?? null,
      discountTotal: coupon.discountTotal ? coupon.discountTotal.toNumber() : null,
      voidReason: coupon.voidReason,
      createdAt: coupon.createdAt.toISOString(),
    };
  }
}
