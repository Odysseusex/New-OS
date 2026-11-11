import {
  DEFAULT_LOYALTY_SETTINGS,
  LoyaltyConsentSource as S,
  LoyaltyTier as L,
  loyaltyTierBySpend,
  loyaltyTierDto,
  PaymentMethod,
  ProductType,
  resolveLoyaltyTier,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";

// Levels: 1 % → 2 % → 3 % by own spend over a rolling window; a level reached is
// kept at least `tierHoldDays`.

describe("level maths", () => {
  const s = { ...DEFAULT_LOYALTY_SETTINGS, tiersEnabled: true };
  const d = (iso: string) => new Date(iso);

  it("spend picks the level by the thresholds", () => {
    expect(loyaltyTierBySpend(29_999.99, s)).toBe(L.BASE);
    expect(loyaltyTierBySpend(30_000, s)).toBe(L.SILVER);
    expect(loyaltyTierBySpend(75_000, s)).toBe(L.GOLD);
  });

  it("a higher level is taken at once and held; a lower one waits for the hold to end", () => {
    const now = d("2026-11-11T10:00:00Z");
    const up = resolveLoyaltyTier({ earned: L.GOLD, stored: L.BASE, heldUntil: null, now, holdDays: 30 });
    expect(up).toEqual({ tier: L.GOLD, heldUntil: d("2026-12-11T10:00:00Z") });
    expect(resolveLoyaltyTier({ earned: L.BASE, stored: L.GOLD, heldUntil: up.heldUntil, now: d("2026-12-01T10:00:00Z"), holdDays: 30 }).tier).toBe(L.GOLD);
    expect(resolveLoyaltyTier({ earned: L.SILVER, stored: L.GOLD, heldUntil: up.heldUntil, now: d("2026-12-12T10:00:00Z"), holdDays: 30 })).toEqual({ tier: L.SILVER, heldUntil: null });
  });

  it("the card says what is left to the next level, and until when a level is kept", () => {
    expect(loyaltyTierDto({ tier: L.BASE, heldUntil: null, spend: 25_500, settings: s })).toMatchObject({
      percent: 1,
      next: { tier: L.SILVER, percent: 2, threshold: 30_000, remaining: 4_500 },
      heldUntil: null,
    });
    const held = new Date("2026-12-11T10:00:00Z");
    expect(loyaltyTierDto({ tier: L.GOLD, heldUntil: held, spend: 80_000, settings: s })).toMatchObject({ percent: 3, next: null, heldUntil: null });
    expect(loyaltyTierDto({ tier: L.GOLD, heldUntil: held, spend: 10_000, settings: s }).heldUntil).toBe(held.toISOString());
  });
});

describe("levels on real sales (database)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  let org: IsolatedOrg;
  let bread: string;
  let honey: string;

  const register = async (phone: string) => (await loyalty.register(org.user, { phone, personalDataConsent: true, source: S.AT_TILL })).id;
  const sell = (memberId: string, productId: string, quantity: number, unitPrice: number) =>
    services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, loyaltyMemberId: memberId, items: [{ productId, quantity, unitPrice }] } as never);

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    org = await createIsolatedOrg(prisma, "loyalty-tiers");
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Сельский магазин" } });
    const mk = (data: object) =>
      prisma.product.create({ data: { organizationId: org.organizationId, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false, ...data } as never });
    bread = (await mk({ name: "Хлеб", sku: "LT-1", price: 1000 })).id;
    honey = (await mk({ name: "Мёд (под реализацию)", sku: "LT-2", price: 1000, consignmentSupplierId: supplier.id })).id;
    await points.updateSettings(org.user, { enabled: true, firstPurchaseEarnPercent: 1 });
  });

  afterAll(async () => {
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("settings: off by default; thresholds and percents are checked", async () => {
    expect(await points.getSettings(org.organizationId)).toMatchObject({ tiersEnabled: false, silverThreshold: 30000, goldThreshold: 75000, silverPercent: 2, goldPercent: 3, tierWindowDays: 90, tierHoldDays: 30 });
    await expect(points.updateSettings(org.user, { goldThreshold: 20000 })).rejects.toThrow(/больше порога/);
    await expect(points.updateSettings(org.user, { goldPercent: 1 })).rejects.toThrow(/не может быть меньше/);
    await expect(points.updateSettings(org.user, { tierWindowDays: 3 })).rejects.toThrow(/от 7 до 730/);
  });

  it("while levels are off everyone earns the ordinary percent and the card shows no level", async () => {
    const memberId = await register("+77071000201");
    await sell(memberId, bread, 40, 1000);
    expect((await sell(memberId, bread, 1, 1000)).loyalty?.pointsEarned).toBe(10);
    expect((await loyalty.findOne(org.organizationId, memberId)).tier).toBeNull();
  });

  it("with levels on: the percent is the level the member came with; consignment goods and returns do not count", async () => {
    await points.updateSettings(org.user, { tiersEnabled: true });
    const memberId = await register("+77071000202");
    // 29 000 of our goods + 5 000 of somebody else's: still below Серебро.
    await sell(memberId, bread, 29, 1000);
    await sell(memberId, honey, 5, 1000);
    expect((await loyalty.findOne(org.organizationId, memberId)).tier).toMatchObject({ tier: L.BASE, percent: 1, spend: 29_000, next: { tier: L.SILVER, remaining: 1_000 } });

    // The purchase that crosses the threshold still earns 1 %; the next one earns 2 %.
    const crossing = await sell(memberId, bread, 2, 1000);
    expect(crossing.loyalty?.pointsEarned).toBe(20);
    expect((await loyalty.findOne(org.organizationId, memberId)).tier).toMatchObject({ tier: L.SILVER, percent: 2, spend: 31_000 });
    expect((await sell(memberId, bread, 1, 1000)).loyalty?.pointsEarned).toBe(20);

    // Gold.
    await sell(memberId, bread, 50, 1000);
    expect((await sell(memberId, bread, 1, 1000)).loyalty?.pointsEarned).toBe(30);

    // A return takes the spend down, but the level is kept for the hold…
    await services.returns.create(org.user, crossing.id, { items: [{ productId: bread, quantity: 2 }] } as never);
    const stored = await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: memberId } });
    expect(stored.tier).toBe(L.GOLD);
    expect(stored.tierHeldUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    // …and once the hold is over and the purchases have left the window, it drops.
    await prisma.sale.updateMany({ where: { loyaltyMemberId: memberId }, data: { soldAt: new Date(Date.now() - 100 * 86_400_000) } });
    expect((await loyalty.findOne(org.organizationId, memberId)).tier).toMatchObject({ tier: L.GOLD, spend: 0 });
    await prisma.loyaltyMember.update({ where: { id: memberId }, data: { tierHeldUntil: new Date(Date.now() - 1000) } });
    expect((await loyalty.findOne(org.organizationId, memberId)).tier).toMatchObject({ tier: L.BASE, percent: 1, heldUntil: null });
    expect((await sell(memberId, bread, 1, 1000)).loyalty?.pointsEarned).toBe(10);
  });
});
