import { LoyaltyConsentSource as S, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { isPushServiceUrl } from "../club/club.controller";
import { ClubPushService, ClubPushTarget } from "./club-push.service";
import { CustomerBotService } from "./customer-bot.service";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";

// Notifications of the customer app: a phone subscribes, a notice goes to the
// member's phones once per key, a phone that is gone is forgotten, and a member
// with the app gets the notice there and on no other channel.

describe("customer app notifications (database)", () => {
  const prisma = new PrismaService();
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const push = new ClubPushService(prisma);
  const bot = new CustomerBotService(prisma, points, undefined, push);
  const services = buildServices(prisma);
  const sent: { endpoint: string; payload: { title: string; body: string; tag: string; url: string } }[] = [];
  let gone = new Set<string>();
  let org: IsolatedOrg;
  let bread: string;

  const device = (n: number): ClubPushTarget => ({ endpoint: `https://fcm.googleapis.com/fcm/send/tiers-${org.organizationId}-${n}`, p256dh: "p", auth: "a" });
  const register = async (phone: string) => (await loyalty.register(org.user, { phone, personalDataConsent: true, source: S.AT_TILL })).id;
  const sell = (memberId: string, quantity: number) =>
    services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, loyaltyMemberId: memberId, items: [{ productId: bread, quantity, unitPrice: 1000 }] } as never);

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "club-push");
    bread = (
      await prisma.product.create({
        data: { organizationId: org.organizationId, name: "Хлеб", sku: "CP-1", price: 1000, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false } as never,
      })
    ).id;
    await points.updateSettings(org.user, { enabled: true, firstPurchaseEarnPercent: 2, earnPercent: 2, tiersEnabled: true });
    push.transport = async (target, payload) => {
      if (gone.has(target.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
    };
  });

  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  beforeEach(() => {
    sent.length = 0;
    gone = new Set();
  });

  it("the server's key is stable and only real push services are accepted", () => {
    expect(push.publicKey()).toBe(new ClubPushService(prisma).publicKey());
    expect(Buffer.from(push.publicKey(), "base64url")).toHaveLength(65);
    expect(isPushServiceUrl("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushServiceUrl("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushServiceUrl("https://example.com/abc")).toBe(false);
    expect(isPushServiceUrl("http://fcm.googleapis.com/abc")).toBe(false);
    expect(isPushServiceUrl("https://localhost/abc")).toBe(false);
  });

  it("a notice goes to every phone of the member, once per key; a phone that is gone is forgotten", async () => {
    const memberId = await register("+77071000301");
    expect(await push.send(memberId, "k1", { title: "t", body: "b" })).toBe(false);
    await push.subscribe(org.organizationId, memberId, device(1));
    await push.subscribe(org.organizationId, memberId, device(2));
    await push.subscribe(org.organizationId, memberId, device(2));
    expect(await push.send(memberId, "k1", { title: "Привет", body: "Текст" })).toBe(true);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([device(1).endpoint, device(2).endpoint]);
    expect(sent[0].payload).toEqual({ title: "Привет", body: "Текст", tag: "k1", url: "/app" });
    expect(await push.send(memberId, "k1", { title: "Привет", body: "Текст" })).toBe(false);
    expect(sent).toHaveLength(2);

    gone = new Set([device(1).endpoint]);
    expect(await push.send(memberId, "k2", { title: "t", body: "b" })).toBe(true);
    expect(await prisma.clubPushSubscription.count({ where: { memberId } })).toBe(1);

    // Every phone gone: nothing delivered, and the key stays free for a later try.
    gone = new Set([device(2).endpoint]);
    expect(await push.send(memberId, "k3", { title: "t", body: "b" })).toBe(false);
    expect(await prisma.clubPushNotice.count({ where: { memberId, key: "k3" } })).toBe(0);
    expect(await push.hasDevices(memberId)).toBe(false);
  });

  it("a purchase tells the app what was earned, and a new level when it was reached", async () => {
    const memberId = await register("+77071000302");
    await push.subscribe(org.organizationId, memberId, device(3));
    const first = await sell(memberId, 20);
    await bot.notifySale(first as never, null);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.title).toMatch(/Спасибо за покупку на 20\s000 ₸!/);
    expect(sent[0].payload.body).toContain("Начислено: +400");

    // 20 000 + 15 000 crosses Серебро (30 000): the points service reports the lift.
    sent.length = 0;
    const second = await sell(memberId, 15);
    const stored = await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: memberId } });
    expect(stored.tier).toBe("SILVER");
    await bot.notifySale(second as never, { tier: stored.tier as never, percent: 3 });
    expect(sent.map((s) => s.payload.title)).toEqual(["Новый уровень — Серебро", expect.stringMatching(/Спасибо за покупку/)]);
    expect(sent[0].payload.body).toBe("Теперь вы получаете 3% бонусами с каждой покупки.");
  });

  it("a subscription moves with the phone when another member signs in on it", async () => {
    const a = await register("+77071000303");
    const b = await register("+77071000304");
    await push.subscribe(org.organizationId, a, device(4));
    await push.subscribe(org.organizationId, b, device(4));
    expect(await push.hasDevices(a)).toBe(false);
    expect(await push.hasDevices(b)).toBe(true);
    await push.unsubscribe(b, device(4).endpoint);
    expect(await push.hasDevices(b)).toBe(false);
  });
});
