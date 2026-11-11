import { JwtService } from "@nestjs/jwt";
import { LoyaltyConsentSource as S, LoyaltyPointsEntryType as T, MANUAL_WELCOME_BONUS_REASON, PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { AuthService } from "../auth/auth.service";
import { resetPinThrottle } from "../auth/till-pin";
import { UsersService } from "../users/users.service";
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

  describe("given by hand (the first purchase was of goods not in the system)", () => {
    const auth = new AuthService(prisma, new JwtService({ secret: process.env.JWT_SECRET ?? "dev-secret-change-me", signOptions: { expiresIn: "8h" } }));
    const person = async (role: Role, name: string) => {
      const u = await prisma.user.create({
        data: { organizationId: org.organizationId, fullName: name, email: `${role}-${Math.random()}@iso.test`, passwordHash: "x", role, locationId: org.storeId },
      });
      return { ...org.user, id: u.id, fullName: name, role, locationId: org.storeId };
    };

    it("a manager gives the same bonus once; the next real purchase earns the ordinary 1 %", async () => {
      const memberId = await register("+77071000201");
      expect((await loyalty.findOne(org.organizationId, memberId)).welcomeBonusAvailable).toBe(5000);

      expect(await points.activateWelcomeBonus(org.user, memberId)).toBe(5000);
      const entry = await prisma.loyaltyPointsEntry.findFirstOrThrow({ where: { memberId, type: T.EARN } });
      expect(entry).toMatchObject({ saleId: null, reason: MANUAL_WELCOME_BONUS_REASON, ratePercent: null });
      expect(entry.availableAt).toEqual(startOfZonedDay(entry.createdAt, -1));
      expect(entry.expiresAt).toEqual(startOfZonedDay(entry.createdAt, -11));

      const card = await loyalty.findOne(org.organizationId, memberId);
      expect(card.welcomeBonusAvailable).toBeNull();
      expect(card.pointsPending?.points).toBe(5000);
      await expect(points.activateWelcomeBonus(org.user, memberId)).rejects.toThrow(/уже получен/);

      const sale = await sell([{ productId: bread, quantity: 10, unitPrice: 590 }], { loyaltyMemberId: memberId });
      expect(sale.loyalty?.pointsEarned).toBe(59);
      const audit = await prisma.auditLog.findFirst({ where: { organizationId: org.organizationId, action: "loyaltyPoints.welcome", entityId: memberId } });
      expect(audit).not.toBeNull();
    });

    it("refused once a purchase is on record", async () => {
      const memberId = await register("+77071000202");
      await sell([{ productId: bread, quantity: 1, unitPrice: 590 }], { loyaltyMemberId: memberId });
      expect((await loyalty.findOne(org.organizationId, memberId)).welcomeBonusAvailable).toBeNull();
      await expect(points.activateWelcomeBonus(org.user, memberId)).rejects.toThrow(/уже получен/);
    });

    it("a cashier needs a senior cashier's PIN; a senior cashier gives it directly", async () => {
      resetPinThrottle();
      const users = new UsersService(prisma);
      const cashier = await person(Role.CASHIER, "Кассир Айгуль");
      const senior = await person(Role.SENIOR_CASHIER, "Старшая Мадина");
      await users.setPin(org.user, senior.id, "4826");

      const a = await register("+77071000203");
      await expect(points.activateWelcomeBonus(cashier, a)).rejects.toThrow(/старшего кассира/);
      const discountOk = await auth.tillApproval(cashier, "4826", "DISCOUNT");
      await expect(points.activateWelcomeBonus(cashier, a, discountOk.approvalToken)).rejects.toThrow(/не подходит/);
      const { approvalToken } = await auth.tillApproval(cashier, "4826", "WELCOME_BONUS");
      expect(await points.activateWelcomeBonus(cashier, a, approvalToken)).toBe(5000);
      const entry = await prisma.loyaltyPointsEntry.findFirstOrThrow({ where: { memberId: a, type: T.EARN } });
      expect(entry.reason).toContain("Старшая Мадина");

      const b = await register("+77071000204");
      expect(await points.activateWelcomeBonus(senior, b)).toBe(5000);
    });

    it("a member merged with one who already got it by hand cannot get it again", async () => {
      const a = await register("+77071000205");
      const b = await register("+77071000206");
      await points.activateWelcomeBonus(org.user, b);
      await loyalty.merge(org.user, { primaryId: a, duplicateId: b, reason: "Один и тот же человек" } as never);
      expect((await loyalty.findOne(org.organizationId, a)).welcomeBonusAvailable).toBeNull();
      const sale = await sell([{ productId: bread, quantity: 10, unitPrice: 590 }], { loyaltyMemberId: a });
      expect(sale.loyalty?.pointsEarned).toBe(59);
    });
  });

  it("many at once: the named ones, then the whole base page by page; whoever has it already is skipped", async () => {
    const a = await register("+77071000301");
    const b = await register("+77071000302");
    const c = await register("+77071000303");
    expect(await points.activateWelcomeBonusBulk(org.user, { memberIds: [a, b] })).toMatchObject({ given: 2, skipped: 0, points: 5000 });
    expect(await points.activateWelcomeBonusBulk(org.user, { memberIds: [a] })).toMatchObject({ given: 0, skipped: 1 });
    await expect(points.activateWelcomeBonusBulk(org.user, { memberIds: [] })).rejects.toThrow(/Выберите клиентов/);
    // The whole base: c gets it, everyone who had it or bought already does not get a second one.
    let given = 0;
    let afterId: string | undefined;
    for (;;) {
      const page = await points.activateWelcomeBonusBulk(org.user, { all: true, afterId });
      given += page.given;
      if (!page.nextAfterId) break;
      afterId = page.nextAfterId;
    }
    expect(given).toBeGreaterThanOrEqual(1);
    expect((await loyalty.findOne(org.organizationId, c)).welcomeBonusAvailable).toBeNull();
    expect(await prisma.loyaltyPointsEntry.count({ where: { memberId: { in: [a, b, c] }, reason: { startsWith: MANUAL_WELCOME_BONUS_REASON } } })).toBe(3);
    expect((await points.activateWelcomeBonusBulk(org.user, { all: true })).given).toBe(0);
  });

  it("with the bonus at 0 the first-purchase percent applies again", async () => {
    await points.updateSettings(org.user, { welcomeBonusPoints: 0 });
    const memberId = await register("+77071000106");
    const sale = await sell([{ productId: bread, quantity: 2, unitPrice: 590 }], { loyaltyMemberId: memberId });
    expect(sale.loyalty?.pointsEarned).toBe(59);
    // Nothing to give by hand when the welcome bonus is a percent.
    const other = await register("+77071000207");
    expect((await loyalty.findOne(org.organizationId, other)).welcomeBonusAvailable).toBeNull();
    await expect(points.activateWelcomeBonus(org.user, other)).rejects.toThrow(/не задан/);
  });
});
