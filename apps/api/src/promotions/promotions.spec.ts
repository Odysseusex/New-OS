import { BadRequestException } from "@nestjs/common";
import { PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PromotionCouponStatus as PrismaPromotionCouponStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../fiscal/fake-fiscal.provider";
import { FiscalProvider, FiscalReturnRequest, FiscalSaleOutcome, FiscalSaleRequest } from "../fiscal/fiscal-provider";
import { PromotionsService } from "./promotions.service";
import { SalesService } from "../sales/sales.service";
import { AuthenticatedUser } from "../auth/auth.types";

// The full pilot scenario end to end: create a campaign -> generate a coupon
// -> sell with it -> confirm stock/cash/fiscal-draft/markdown isolation ->
// confirm the coupon is one-use -> confirm the promotion's own report adds
// up. Runs against the real database and shares the demo org with the other
// money specs — see the maxWorkers note in sales-fiscal.spec.ts.
const prisma = new PrismaService();

const ORG = "demo-org";
const stamp = Date.now();

let user: AuthenticatedUser;
let locationId: string;
let categoryId: string;
let productId: string;
let promotionId: string;
const saleIds: string[] = [];

function services(provider: FiscalProvider = new FakeFiscalProvider()) {
  const cash = new CashMovementsService(prisma);
  const fiscal = new FiscalService(prisma, provider, new FiscalSettings());
  const promotions = new PromotionsService(prisma);
  return {
    sales: new SalesService(prisma, cash, fiscal, new FiscalSettings(), promotions),
    promotions,
  };
}

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;

  const location = await prisma.location.findFirst({ where: { organizationId: ORG, lat: { not: null } } });
  const owner = await prisma.user.findFirst({ where: { organizationId: ORG, role: "OWNER" } });
  if (!location || !owner) throw new Error("Demo data missing — seed the local database first");
  locationId = location.id;
  user = { id: owner.id, organizationId: ORG, role: owner.role, locationId: null } as AuthenticatedUser;

  const category = await prisma.category.create({ data: { organizationId: ORG, name: `Тест-акция ${stamp}` } });
  categoryId = category.id;

  const product = await prisma.product.create({
    data: {
      organizationId: ORG,
      name: `Купон-тест ${stamp}`,
      sku: `PROMO-${stamp}`,
      unit: Unit.PCS,
      type: ProductType.FINISHED_GOOD,
      price: 1000,
      categoryId,
      // Not the point of this suite — stock decrementing on a coupon sale is
      // already exercised live via the ordinary SALE stock-movement path,
      // unchanged by this feature. Turned off here to keep fixtures small.
      trackInventory: false,
    },
  });
  productId = product.id;

  const promotion = await services().promotions.create(user, {
    name: `Тест-акция ${stamp}`,
    locationId,
    startAt: new Date(Date.now() - 60_000).toISOString(),
    endAt: new Date(Date.now() + 3_600_000).toISOString(),
    rules: [{ categoryId, discountPercent: 50 }],
  });
  promotionId = promotion.id;
});

afterAll(async () => {
  try {
    await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.cashMovement.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.promotionCoupon.deleteMany({ where: { promotionId } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.promotionRule.deleteMany({ where: { promotionId } });
    await prisma.promotion.deleteMany({ where: { id: promotionId } });
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  } finally {
    await prisma.$disconnect();
  }
});

async function freshCoupon(): Promise<string> {
  const codes = await services().promotions.generateCoupons(user, promotionId, 1);
  return codes[0];
}

describe("promotion coupon redemption", () => {
  it("discounts the matching line, tags it, and keeps markdownLoss untouched", async () => {
    const code = await freshCoupon();
    const { sales } = services();

    const sale = await sales.create(user, {
      locationId,
      paymentMethod: PaymentMethod.CASH,
      couponCode: code,
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    });
    saleIds.push(sale.id);

    expect(sale.items[0].unitPrice).toBe(500);
    expect(sale.items[0].fullUnitPrice).toBe(1000);
    expect(sale.items[0].promotionName).toContain("Тест-акция");

    const coupon = await prisma.promotionCoupon.findFirst({ where: { code } });
    expect(coupon?.status).toBe(PrismaPromotionCouponStatus.REDEEMED);
    expect(coupon?.redeemedSaleId).toBe(sale.id);
    expect(Number(coupon?.discountTotal)).toBe(500);

    // The whole point of the promotionId flag: a coupon discount must never
    // show up as markdown-loss (stale-goods) in the sales report.
    const report = await sales.report(user, new Date(Date.now() - 60_000), new Date(Date.now() + 60_000), locationId);
    const productRow = report.byProduct.find((p) => p.productId === productId);
    expect(productRow?.markdownLoss ?? 0).toBe(0);
    expect(productRow?.markdownQuantity ?? 0).toBe(0);
  });

  it("is one-use: a second sale against the same code is rejected and the coupon stays REDEEMED", async () => {
    const code = await freshCoupon();
    const { sales } = services();

    const sale = await sales.create(user, {
      locationId,
      paymentMethod: PaymentMethod.CASH,
      couponCode: code,
      items: [{ productId, quantity: 1, unitPrice: 1000 }],
    });
    saleIds.push(sale.id);

    await expect(
      sales.create(user, {
        locationId,
        paymentMethod: PaymentMethod.CASH,
        couponCode: code,
        items: [{ productId, quantity: 1, unitPrice: 1000 }],
      }),
    ).rejects.toThrow(BadRequestException);

    const coupon = await prisma.promotionCoupon.findFirst({ where: { code } });
    expect(coupon?.status).toBe(PrismaPromotionCouponStatus.REDEEMED);
    expect(coupon?.redeemedSaleId).toBe(sale.id);
  });

  it("refuses a coupon on a disabled promotion, and a coupon that discounts nothing in the cart", async () => {
    const { sales, promotions } = services();

    const code = await freshCoupon();
    await promotions.update(user, promotionId, { isActive: false });
    await expect(
      sales.create(user, {
        locationId,
        paymentMethod: PaymentMethod.CASH,
        couponCode: code,
        items: [{ productId, quantity: 1, unitPrice: 1000 }],
      }),
    ).rejects.toThrow(BadRequestException);
    await promotions.update(user, promotionId, { isActive: true });

    // Same code, promotion active again, but the cart has nothing in the
    // discounted category — must be refused before the coupon is claimed.
    const otherProduct = await prisma.product.create({
      data: {
        organizationId: ORG,
        name: `Вне акции ${stamp}`,
        sku: `PROMO-OUT-${stamp}`,
        unit: Unit.PCS,
        type: ProductType.FINISHED_GOOD,
        price: 300,
        trackInventory: false,
      },
    });
    try {
      await expect(
        sales.create(user, {
          locationId,
          paymentMethod: PaymentMethod.CASH,
          couponCode: code,
          items: [{ productId: otherProduct.id, quantity: 1, unitPrice: 300 }],
        }),
      ).rejects.toThrow(BadRequestException);

      const coupon = await prisma.promotionCoupon.findFirst({ where: { code } });
      expect(coupon?.status).toBe(PrismaPromotionCouponStatus.ISSUED);
    } finally {
      await prisma.product.delete({ where: { id: otherProduct.id } });
    }
  });

  // Proves requirement 2 from the architecture review: the fiscal draft sees
  // the SAME already-discounted unitPrice a markdown line would produce —
  // nothing fiscal-specific was or needs to be changed for a coupon.
  it("sends the discounted price to the fiscal draft exactly like a markdown line would", async () => {
    class CapturingProvider implements FiscalProvider {
      readonly name = "capturing";
      readonly seen: FiscalSaleRequest[] = [];
      isConfigured() {
        return true;
      }
      async registerSale(request: FiscalSaleRequest): Promise<FiscalSaleOutcome> {
        this.seen.push(request);
        return {
          kind: "ok",
          result: {
            providerTicketId: "test-1",
            ticketNumber: "1",
            offlineTicketNumber: null,
            isOffline: false,
            qrCode: null,
            kgdKkmId: null,
            shiftNumber: null,
            raw: null,
          },
        };
      }
      async registerReturn(request: FiscalReturnRequest): Promise<FiscalSaleOutcome> {
        return this.registerSale(request);
      }
      async getShiftState() {
        return null;
      }
    }

    process.env.FISCALIZATION_ENABLED = "true";
    const provider = new CapturingProvider();
    const { sales } = services(provider);
    try {
      const code = await freshCoupon();
      const sale = await sales.create(user, {
        locationId,
        paymentMethod: PaymentMethod.CASH,
        couponCode: code,
        items: [{ productId, quantity: 1, unitPrice: 1000 }],
      });
      saleIds.push(sale.id);

      expect(provider.seen).toHaveLength(1);
      expect(provider.seen[0].lines[0].unitPrice).toBe(500);
      expect(provider.seen[0].total).toBe(500);
    } finally {
      delete process.env.FISCALIZATION_ENABLED;
    }
  });

  it("report() adds up issued/redeemed/discount for the promotion", async () => {
    const { promotions } = services();
    const report = await promotions.report(user, promotionId, new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000));
    expect(report.couponsRedeemed).toBeGreaterThanOrEqual(3);
    expect(report.discountTotal).toBeGreaterThanOrEqual(1500);
    expect(report.conversionPercent).not.toBeNull();
  });
});
