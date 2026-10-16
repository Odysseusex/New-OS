import {
  distributePointsDiscount,
  LoyaltyConsentPurpose as P,
  LoyaltyConsentSource as S,
  LoyaltyPointsEntryType as T,
  loyaltyRedeemCap,
  PaymentMethod,
  ProductType,
  Unit,
} from "@bakery-os/shared";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";
import { pointsPosition } from "./points-ledger";

// Loyalty stage 2: points. 1 point = 1 ₸; paying with points is a discount on
// the check («способ Б»), so it travels through the existing discount path.

describe("distributePointsDiscount / loyaltyRedeemCap", () => {
  const line = (unitPrice: number, quantity = 1, extra: object = {}) => ({ unitPrice, quantity, consignment: false, ...extra });

  it("spreads points over lines in proportion to their value, as a lower unit price", () => {
    const result = distributePointsDiscount([line(1000), line(500)], 300);
    expect(result.total).toBe(300);
    expect(result.lines.map((l) => [l.index, l.unitPrice, l.discount])).toEqual([
      [0, 800, 200],
      [1, 400, 100],
    ]);
  });

  it("never touches a markdown, a coupon line or goods «под реализацию»", () => {
    const result = distributePointsDiscount(
      [line(1000, 1, { fullUnitPrice: 1200 }), line(800, 1, { consignment: true }), line(500)],
      100,
    );
    expect(result.lines.map((l) => l.index)).toEqual([2]);
    expect(result.total).toBe(100);
  });

  it("weighed goods: never more than asked, and a whole-тиын unit price", () => {
    const result = distributePointsDiscount([line(1200, 0.355)], 50);
    expect(result.total).toBeLessThanOrEqual(50);
    expect(result.total).toBeGreaterThan(49.5);
    expect(Number.isInteger(Math.round(result.lines[0].unitPrice * 100))).toBe(true);
  });

  it("the cap is the share limit of eligible goods, and never more than the balance", () => {
    expect(loyaltyRedeemCap([line(2000), line(590, 1, { fullUnitPrice: 700 })], 30, 1000)).toBe(600);
    expect(loyaltyRedeemCap([line(2000)], 30, 79.5)).toBe(79.5);
  });
});

describe("pointsPosition (expiry, earliest lot first)", () => {
  const d = (s: string) => new Date(s);
  const row = (id: string, type: string, points: number, createdAt: string, expiresAt?: string) => ({
    id,
    type,
    points,
    createdAt: d(createdAt),
    expiresAt: expiresAt ? d(expiresAt) : null,
  });

  it("spends the earliest-expiring lot first; what is left of it expires on its date", () => {
    const rows = [
      row("a", T.EARN, 50, "2026-01-01", "2027-01-01"),
      row("b", T.EARN, 50, "2026-06-01", "2027-06-01"),
      row("c", T.REDEEM, -60, "2026-07-01"),
    ];
    expect(pointsPosition(rows, d("2026-08-01")).available).toBe(40);
    // Lot a is gone; lot b (40 left) expires in June 2027.
    expect(pointsPosition(rows, d("2027-02-01"))).toMatchObject({ available: 40, dueToExpire: 0 });
    expect(pointsPosition(rows, d("2027-07-01"))).toMatchObject({ available: 0, dueToExpire: 40 });
  });

  it("an EXPIRE entry writes off exactly what had expired", () => {
    const rows = [
      row("a", T.EARN, 30, "2025-01-01", "2026-01-01"),
      row("b", T.EARN, 20, "2025-06-01", "2027-06-01"),
      row("c", T.EXPIRE, -30, "2026-02-01"),
    ];
    expect(pointsPosition(rows, d("2026-03-01"))).toMatchObject({ available: 20, dueToExpire: 0 });
  });
});

describe("points on real sales (database)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  let org: IsolatedOrg;
  let bread: string;
  let cake: string;
  let consigned: string;
  let memberId: string;
  let thirdSaleId: string;
  const from = new Date(Date.now() - 3600_000);
  const to = () => new Date(Date.now() + 3600_000);

  const register = async (phone: string) =>
    (await loyalty.register(org.user, { phone, personalDataConsent: true, source: S.AT_TILL })).id;
  const balance = async (id = memberId) => (await points.balances(org.organizationId, [id])).get(id);
  const sell = (items: object[], extra: object = {}) =>
    services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items, ...extra } as never);

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    org = await createIsolatedOrg(prisma, "loyalty-points");
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Сельский магазин" } });
    const mk = (data: object) =>
      prisma.product.create({
        data: { organizationId: org.organizationId, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false, ...data } as never,
      });
    bread = (await mk({ name: "Хлеб", sku: "LP-1", price: 590 })).id;
    cake = (await mk({ name: "Торт", sku: "LP-2", price: 2000 })).id;
    consigned = (await mk({ name: "Мёд (под реализацию)", sku: "LP-3", price: 1000, consignmentSupplierId: supplier.id })).id;
    memberId = await register("+77071000001");
  });

  afterAll(async () => {
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("while the programme is off, a member cannot be attached", async () => {
    await expect(sell([{ productId: bread, quantity: 1, unitPrice: 590 }], { loyaltyMemberId: memberId })).rejects.toThrow(/выключена/);
  });

  it("first purchase earns 5 % on our own goods at full price; goods «под реализацию» earn nothing", async () => {
    await points.updateSettings(org.user, { enabled: true });
    const sale = await sell(
      [
        { productId: bread, quantity: 2, unitPrice: 590 },
        { productId: consigned, quantity: 1, unitPrice: 1000 },
      ],
      { loyaltyMemberId: memberId },
    );
    expect(sale.loyalty).toMatchObject({ memberId, pointsEarned: 59, pointsRedeemed: 0 });
    expect(await balance()).toBe(59);
  });

  it("later purchases earn 1 %, and a marked-down line earns nothing", async () => {
    const sale = await sell(
      [
        { productId: cake, quantity: 1, unitPrice: 2000 },
        { productId: bread, quantity: 1, unitPrice: 413, fullUnitPrice: 590 },
      ],
      { loyaltyMemberId: memberId },
    );
    expect(sale.loyalty?.pointsEarned).toBe(20);
    expect(await balance()).toBe(79);
  });

  it("paying with points is a discount on the line; it earns only on the money part", async () => {
    const sale = await sell(
      [
        { productId: cake, quantity: 1, unitPrice: 2000 },
        { productId: bread, quantity: 1, unitPrice: 413, fullUnitPrice: 590 },
      ],
      { loyaltyMemberId: memberId, loyaltyPointsToRedeem: 79 },
    );
    thirdSaleId = sale.id;
    expect(sale.totalAmount).toBe(2000 - 79 + 413);
    const cakeLine = sale.items.find((i) => i.productId === cake)!;
    expect(cakeLine).toMatchObject({ unitPrice: 1921, fullUnitPrice: 2000, subtotal: 1921 });
    expect(sale.loyalty).toMatchObject({ pointsRedeemed: 79, pointsEarned: 19.21 });
    expect(await balance()).toBe(19.21);
    // The money taken is the discounted total, not the price list.
    const cash = await prisma.cashMovement.findMany({ where: { saleId: sale.id } });
    expect(cash.reduce((s, c) => s + c.amount.toNumber(), 0)).toBe(2334);
  });

  it("the P&L shows points in its discounts line, like a coupon; it is not a markdown", async () => {
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to());
    // Two markdowns of 177 ₸ + 79 ₸ of points.
    expect(pnl.discountsTotal).toBe(433);
    const report = await services.sales.report(org.user, from, to());
    expect(report.markdownLoss).toBe(354);
  });

  it("refuses more than the limit or the balance", async () => {
    await expect(
      sell([{ productId: cake, quantity: 1, unitPrice: 2000 }], { loyaltyMemberId: memberId, loyaltyPointsToRedeem: 50 }),
    ).rejects.toThrow(/не больше 19.21/);
    await expect(sell([{ productId: cake, quantity: 1, unitPrice: 2000 }], { loyaltyPointsToRedeem: 5 })).rejects.toThrow(/укажите клиента/);
  });

  it("a return gives back the points the sale spent and takes back what it earned", async () => {
    const ret = await services.returns.create(org.user, thirdSaleId, { items: [{ productId: cake, quantity: 1 }] } as never);
    expect(ret.totalAmount).toBe(1921); // money back = money paid for the cake
    // 19.21 + 79 refunded − 19.21 earned on that cake.
    expect(await balance()).toBe(79);
    const entries = await prisma.loyaltyPointsEntry.findMany({ where: { saleReturnId: ret.id } });
    expect(entries.map((e) => [e.type, e.points.toNumber()]).sort()).toEqual([
      [T.EARN_REVERSAL, -19.21],
      [T.REDEEM_REFUND, 79],
    ]);
  });

  it("expired points are written off when the card is opened", async () => {
    const past = new Date(Date.now() - 400 * 86_400_000);
    await prisma.loyaltyPointsEntry.create({
      data: {
        organizationId: org.organizationId,
        memberId,
        type: T.ADJUSTMENT,
        points: 15,
        reason: "старое начисление",
        createdAt: past,
        expiresAt: new Date(past.getTime() + 365 * 86_400_000),
      },
    });
    expect(await balance()).toBe(79);
    const card = await loyalty.findOne(org.organizationId, memberId);
    expect(card.pointsBalance).toBe(79);
    expect(card.pointsHistory[0]).toMatchObject({ type: T.EXPIRE, points: -15 });
  });

  it("manual correction: owner/admin, with a reason, never below zero", async () => {
    await expect(points.adjust(org.user, memberId, { points: 10, reason: "нет" })).rejects.toThrow(/причину/);
    await expect(points.adjust(org.user, memberId, { points: -1000, reason: "ошибка кассира" })).rejects.toThrow(/больше, чем на счёте/);
    expect(await points.adjust(org.user, memberId, { points: 21, reason: "Компенсация за ошибку" })).toBe(100);
  });

  it("merging moves the duplicate's points, each lot keeping its expiry", async () => {
    const dup = await register("+77071000002");
    await points.adjust(org.user, dup, { points: 25, reason: "Начальный остаток" });
    await loyalty.merge(org.user, { primaryId: memberId, duplicateId: dup, reason: "Один человек, два номера" });
    expect(await balance()).toBe(125);
    expect(await balance(dup)).toBe(0);
  });

  it("a member without consent cannot be attached at the till", async () => {
    const other = await register("+77071000003");
    await loyalty.recordConsent(org.user, other, { purpose: P.PERSONAL_DATA, granted: false, source: S.AT_TILL });
    await expect(sell([{ productId: bread, quantity: 1, unitPrice: 590 }], { loyaltyMemberId: other })).rejects.toThrow(/не участвует/);
  });

  it("the points history cannot be edited", async () => {
    const row = await prisma.loyaltyPointsEntry.findFirstOrThrow({ where: { organizationId: org.organizationId } });
    await expect(prisma.loyaltyPointsEntry.update({ where: { id: row.id }, data: { reason: "x" } })).rejects.toThrow(/не изменяется/);
  });

  it("summary: points on hand, earned, spent net of refunds", async () => {
    const summary = await points.summary(org.organizationId, from, to());
    expect(summary).toMatchObject({ pointsOutstanding: 125, membersWithPoints: 1, pointsEarned: 79, pointsRedeemed: 0, pointsExpired: 15 });
  });

  it("settings changes and corrections are audited", async () => {
    const logged = new Set(
      (await prisma.auditLog.findMany({ where: { organizationId: org.organizationId }, select: { action: true } })).map((a) => a.action),
    );
    expect(AUDIT_ACTION_GROUPS.loyaltyPoints.filter((a) => !logged.has(a))).toEqual([]);
  });
});
