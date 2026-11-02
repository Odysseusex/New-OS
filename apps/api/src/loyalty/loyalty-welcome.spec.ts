import { LoyaltyConsentSource as S, LoyaltyPointsEntryType as T, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { startOfZonedDay } from "../common/zoned-day";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";
import { pointsPosition } from "./points-ledger";

// Welcome bonus: a fixed sum in points for the first purchase, instead of the
// first-purchase percent; usable from the next day (Almaty) for N days.

describe("pointsPosition with a lot that waits for its first day", () => {
  const d = (s: string) => new Date(s);
  const rows = [
    { id: "a", type: T.EARN, points: 100, createdAt: d("2026-11-01T10:00:00Z"), expiresAt: d("2027-11-01T10:00:00Z") },
    { id: "w", type: T.EARN, points: 5000, createdAt: d("2026-11-02T10:00:00Z"), availableAt: d("2026-11-02T19:00:00Z"), expiresAt: d("2026-11-12T19:00:00Z") },
  ];

  it("is held but not spendable before availableAt; spendable after; expires on its date", () => {
    expect(pointsPosition(rows, d("2026-11-02T12:00:00Z"))).toMatchObject({ available: 100, pending: 5000, pendingFrom: d("2026-11-02T19:00:00Z") });
    expect(pointsPosition(rows, d("2026-11-03T08:00:00Z"))).toMatchObject({ available: 5100, pending: 0, pendingFrom: null });
    expect(pointsPosition(rows, d("2026-11-13T08:00:00Z"))).toMatchObject({ available: 100, dueToExpire: 5000 });
  });

  it("a purchase the same day cannot spend it; a return of the purchase takes it back", () => {
    const spent = [...rows, { id: "r", type: T.REDEEM, points: -100, createdAt: d("2026-11-02T12:00:00Z"), expiresAt: null }];
    expect(pointsPosition(spent, d("2026-11-03T08:00:00Z"))).toMatchObject({ available: 5000 });
    const reversed = [...rows, { id: "x", type: T.EARN_REVERSAL, points: -5000, createdAt: d("2026-11-02T12:00:00Z"), expiresAt: null }];
    expect(pointsPosition(reversed, d("2026-11-03T08:00:00Z"))).toMatchObject({ available: 100, pending: 0 });
  });
});

describe("welcome bonus on real sales (database)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  let org: IsolatedOrg;
  let bread: string;
  let consigned: string;

  const register = async (phone: string) =>
    (await loyalty.register(org.user, { phone, personalDataConsent: true, source: S.AT_TILL })).id;
  const sell = (items: object[], extra: object = {}) =>
    services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items, ...extra } as never);

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    org = await createIsolatedOrg(prisma, "loyalty-welcome");
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Сельский магазин" } });
    const mk = (data: object) =>
      prisma.product.create({
        data: { organizationId: org.organizationId, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false, ...data } as never,
      });
    bread = (await mk({ name: "Хлеб", sku: "LW-1", price: 590 })).id;
    consigned = (await mk({ name: "Мёд (под реализацию)", sku: "LW-2", price: 1000, consignmentSupplierId: supplier.id })).id;
    await points.updateSettings(org.user, { enabled: true, welcomeBonusPoints: 5000, welcomeBonusDelayDays: 1, welcomeBonusDays: 10 });
  });

  afterAll(async () => {
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("settings keep the percent and add the bonus fields; bad values are refused", async () => {
    expect(await points.getSettings(org.organizationId)).toMatchObject({ firstPurchaseEarnPercent: 5, welcomeBonusPoints: 5000, welcomeBonusDelayDays: 1, welcomeBonusDays: 10 });
    await expect(points.updateSettings(org.user, { welcomeBonusDays: 0 })).rejects.toThrow(/от 1 до 365/);
    await expect(points.updateSettings(org.user, { welcomeBonusPoints: -1 })).rejects.toThrow(/неотрицательная/);
  });

  it("first purchase gets 5000 instead of 5 %, usable from tomorrow's midnight for 10 days; the next purchase earns 1 %", async () => {
    const memberId = await register("+77071000101");
    const sale = await sell([{ productId: bread, quantity: 1, unitPrice: 590 }], { loyaltyMemberId: memberId });
    expect(sale.loyalty).toMatchObject({ pointsEarned: 5000 });
    const entry = await prisma.loyaltyPointsEntry.findFirstOrThrow({ where: { saleId: sale.id, type: T.EARN } });
    const soldAt = entry.createdAt;
    expect(entry.availableAt).toEqual(startOfZonedDay(soldAt, -1));
    expect(entry.expiresAt).toEqual(startOfZonedDay(soldAt, -11));
    expect(entry.ratePercent).toBeNull();
    expect(entry.reason).toBe("Бонус за первую покупку");

    // Not spendable today: the card shows it as waiting, the till refuses it.
    const card = await loyalty.findOne(org.organizationId, memberId);
    expect(card.pointsBalance).toBe(0);
    expect(card.pointsPending).toEqual({ points: 5000, from: entry.availableAt!.toISOString() });
    await expect(sell([{ productId: bread, quantity: 10, unitPrice: 590 }], { loyaltyMemberId: memberId, loyaltyPointsToRedeem: 100 })).rejects.toThrow();

    const second = await sell([{ productId: bread, quantity: 10, unitPrice: 590 }], { loyaltyMemberId: memberId });
    expect(second.loyalty?.pointsEarned).toBe(59);
    expect((await points.summary(org.organizationId, new Date(0), new Date(Date.now() + 3600_000))).pointsOutstanding).toBeGreaterThanOrEqual(5059);
  });

  it("returning the first purchase takes the bonus back, even before it became usable", async () => {
    const memberId = await register("+77071000102");
    const sale = await sell([{ productId: bread, quantity: 2, unitPrice: 590 }], { loyaltyMemberId: memberId });
    expect(sale.loyalty?.pointsEarned).toBe(5000);
    await services.returns.create(org.user, sale.id, { items: [{ productId: bread, quantity: 2 }] } as never);
    const card = await loyalty.findOne(org.organizationId, memberId);
    expect(card.pointsBalance).toBe(0);
    expect(card.pointsPending).toBeNull();
  });

  it("a basket of consignment goods only earns no bonus", async () => {
    const memberId = await register("+77071000103");
    const sale = await sell([{ productId: consigned, quantity: 1, unitPrice: 1000 }], { loyaltyMemberId: memberId });
    expect(sale.loyalty?.pointsEarned ?? 0).toBe(0);
  });

  it("merging moves a waiting bonus, still waiting", async () => {
    const a = await register("+77071000104");
    const b = await register("+77071000105");
    await sell([{ productId: bread, quantity: 1, unitPrice: 590 }], { loyaltyMemberId: b });
    await loyalty.merge(org.user, { primaryId: a, duplicateId: b, reason: "Один и тот же человек" } as never);
    const card = await loyalty.findOne(org.organizationId, a);
    expect(card.pointsBalance).toBe(0);
    expect(card.pointsPending?.points).toBe(5000);
  });

  it("with the bonus at 0 the first-purchase percent applies again", async () => {
    await points.updateSettings(org.user, { welcomeBonusPoints: 0 });
    const memberId = await register("+77071000106");
    const sale = await sell([{ productId: bread, quantity: 2, unitPrice: 590 }], { loyaltyMemberId: memberId });
    expect(sale.loyalty?.pointsEarned).toBe(59);
  });
});
