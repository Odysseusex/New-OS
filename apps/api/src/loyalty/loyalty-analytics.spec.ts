import { LoyaltyConsentSource as S, LoyaltySegment, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { AnalyticsMember, AnalyticsVisit, computeLoyaltyAnalytics, rfmSegment, RFM_MINIMUM_MEMBERS } from "./analytics";
import { LoyaltyAnalyticsService } from "./loyalty-analytics.service";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";

// Customer analytics: Klaviyo's RFM groups, Square's «lapsed regular» radar,
// Shopify's monthly cohorts — computed from sales with a member attached.

const DAY = 86_400_000;
const to = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) => new Date(to.getTime() - n * DAY);
const dateKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(d);
const member = (id: string, contactable = true): [string, AnalyticsMember] => [id, { id, phone: `+7700${id}`, name: id, contactable }];
const visit = (memberId: string, ago: number, amount = 1000): AnalyticsVisit => ({ memberId, at: daysAgo(ago), amount });
const run = (visits: AnalyticsVisit[], members: [string, AnalyticsMember][], extra: object = {}) =>
  computeLoyaltyAnalytics({
    from: daysAgo(30),
    to,
    visits,
    members: new Map(members),
    anonymous: { visits: 10, revenue: 5000 },
    churn: { minVisits: 3, windowDays: 60, inactiveDays: 14 },
    dateKey,
    ...extra,
  });

describe("computeLoyaltyAnalytics", () => {
  it("summary: active, new, returning, average checks and revenue share", () => {
    const a = run(
      [visit("old", 100), visit("old", 10, 2000), visit("old", 5, 2000), visit("new", 3, 500)],
      [member("old"), member("new")],
    );
    expect(a.summary).toMatchObject({
      activeMembers: 2,
      newMembers: 1,
      returningShare: 0.5,
      memberVisits: 3,
      memberRevenue: 4500,
      averageCheckMembers: 1500,
      averageCheckAnonymous: 500,
      visitsPerMember: 1.5,
    });
    expect(a.summary.memberRevenueShare).toBeCloseTo(4500 / 9500);
  });

  it("RFM groups follow Klaviyo's codes and wait for enough members", () => {
    expect(rfmSegment(3, 3, 3)).toBe(LoyaltySegment.CHAMPIONS);
    expect(rfmSegment(1, 1, 1)).toBe(LoyaltySegment.INACTIVE);
    expect(rfmSegment(2, 3, 1)).toBe(LoyaltySegment.AT_RISK);
    expect(run([visit("x", 1)], [member("x")]).segments).toMatchObject({ available: false, membersScored: 1, rows: [] });

    // 30 members: ten very recent big spenders, ten middling, ten long gone.
    const members: [string, AnalyticsMember][] = [];
    const visits: AnalyticsVisit[] = [];
    for (let i = 0; i < RFM_MINIMUM_MEMBERS; i += 1) {
      const id = `m${i}`;
      members.push(member(id));
      const tier = Math.floor(i / 10);
      const count = [6, 3, 1][tier];
      for (let k = 0; k < count; k += 1) visits.push(visit(id, [1, 40, 200][tier] + k, [3000, 1500, 500][tier]));
    }
    const groups = run(visits, members).segments;
    expect(groups.available).toBe(true);
    expect(groups.groups.find((g) => g.segment === LoyaltySegment.CHAMPIONS)?.members).toBe(10);
    expect(groups.groups.find((g) => g.segment === LoyaltySegment.INACTIVE)?.members).toBe(10);
  });

  it("churn radar: a regular who stopped coming, never someone who withdrew consent", () => {
    const a = run(
      [
        ...[50, 40, 30, 20].map((d) => visit("regular", d)),
        ...[50, 40, 30, 20].map((d) => visit("withdrawn", d)),
        ...[50, 40, 3].map((d) => visit("stillComing", d)),
        visit("oneOff", 20),
      ],
      [member("regular"), member("withdrawn", false), member("stillComing"), member("oneOff")],
    );
    expect(a.churnRadar.rows.map((r) => r.memberId)).toEqual(["regular"]);
    expect(a.churnRadar.rows[0]).toMatchObject({ daysSinceLastVisit: 20, visits: 4, usualIntervalDays: 10 });
  });

  it("visit frequency buckets and new-vs-returning weeks", () => {
    const a = run(
      [visit("a", 2), visit("a", 3), visit("a", 4), visit("b", 2), visit("c", 60), visit("c", 2)],
      [member("a"), member("b"), member("c")],
    );
    expect(a.frequency.map((f) => f.members)).toEqual([2, 0, 1, 0, 0]);
    const totals = a.weekly.reduce((s, w) => ({ n: s.n + w.newMembers, r: s.r + w.returningMembers }), { n: 0, r: 0 });
    expect(totals).toEqual({ n: 2, r: 1 }); // a and b are new; c came back
  });

  it("cohorts: of those who first came in a month, the share back in the next months", () => {
    // August cohort of two (Aug 10): one back in September, none in October yet.
    const aug = new Date("2026-08-10T10:00:00Z");
    const sep = new Date("2026-09-10T10:00:00Z");
    const a = run(
      [
        { memberId: "p", at: aug, amount: 100 },
        { memberId: "q", at: aug, amount: 100 },
        { memberId: "p", at: sep, amount: 100 },
      ],
      [member("p"), member("q")],
    );
    const august = a.cohorts.find((c) => c.month === "2026-08")!;
    expect(august).toEqual({ month: "2026-08", size: 2, retention: [0.5, 0, null] });
  });
});

describe("LoyaltyAnalyticsService (database)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const analytics = new LoyaltyAnalyticsService(prisma);
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  let org: IsolatedOrg;

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    org = await createIsolatedOrg(prisma, "loyalty-analytics");
  });

  afterAll(async () => {
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("counts only our own money, nets returns, credits a merged duplicate to its primary", async () => {
    await points.updateSettings(org.user, { enabled: true });
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Поставщик" } });
    const mk = (data: object) =>
      prisma.product.create({ data: { organizationId: org.organizationId, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false, ...data } as never });
    const bread = (await mk({ name: "Хлеб", sku: "LA-1", price: 500 })).id;
    const honey = (await mk({ name: "Мёд", sku: "LA-2", price: 1000, consignmentSupplierId: supplier.id })).id;
    const reg = async (phone: string) => (await loyalty.register(org.user, { phone, personalDataConsent: true, source: S.AT_TILL })).id;
    const primary = await reg("+77081000001");
    const dup = await reg("+77081000002");
    const sell = (memberId: string | null, items: object[]) =>
      services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items, ...(memberId ? { loyaltyMemberId: memberId } : {}) } as never);

    const s1 = await sell(primary, [{ productId: bread, quantity: 2, unitPrice: 500 }, { productId: honey, quantity: 1, unitPrice: 1000 }]);
    await sell(dup, [{ productId: bread, quantity: 1, unitPrice: 500 }]);
    await sell(primary, [{ productId: honey, quantity: 1, unitPrice: 1000 }]); // consignment only: not our sale
    await sell(null, [{ productId: bread, quantity: 4, unitPrice: 500 }]);
    await services.returns.create(org.user, s1.id, { items: [{ productId: bread, quantity: 1 }] } as never);
    await loyalty.merge(org.user, { primaryId: primary, duplicateId: dup, reason: "Один человек" });

    const a = await analytics.analytics(org.organizationId, new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000), {});
    expect(a.summary).toMatchObject({ activeMembers: 1, memberVisits: 2, memberRevenue: 1000, averageCheckAnonymous: 2000 });
    expect(a.topMembers[0]).toMatchObject({ memberId: primary, visits: 2, spend: 1000 });
  });

  it("refuses nonsense radar settings", async () => {
    await expect(analytics.analytics(org.organizationId, new Date(Date.now() - DAY), new Date(), { minVisits: 0 })).rejects.toThrow(/Параметры радара/);
  });
});
