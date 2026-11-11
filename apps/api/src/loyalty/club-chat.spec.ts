import { LoyaltyConsentSource as S, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { ClubChatService } from "./club-chat.service";
import { ClubPushService } from "./club-push.service";
import { CustomerBotService } from "./customer-bot.service";
import { LoyaltyAnalyticsService } from "./loyalty-analytics.service";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";

// The chat of the customer app: the customer writes from the app, the staff
// answer in CRM, automatic notices land in the same thread, mass messages go to
// a computed group — and only to customers signed in to the app.

describe("customer app chat (database)", () => {
  const prisma = new PrismaService();
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const push = new ClubPushService(prisma);
  const chat = new ClubChatService(prisma, push, new LoyaltyAnalyticsService(prisma), points);
  const bot = new CustomerBotService(prisma, points, undefined, push, chat);
  const services = buildServices(prisma);
  const pushed: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  let org: IsolatedOrg;
  let bread: string;

  const register = async (phone: string) => (await loyalty.register(org.user, { phone, personalDataConsent: true, source: S.AT_TILL })).id;
  // Signed in to the app = a session row.
  const signIn = (memberId: string, phone: string) =>
    prisma.clubLoginRequest.create({
      data: { organizationId: org.organizationId, phone, code: "000000", secretHash: `chat-spec-${memberId}`, status: "USED", memberId, expiresAt: new Date(Date.now() + 3600_000), usedAt: new Date() },
    });
  const flush = () => new Promise((r) => setTimeout(r, 150));

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "club-chat");
    bread = (
      await prisma.product.create({
        data: { organizationId: org.organizationId, name: "Хлеб", sku: "CC-1", price: 1000, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false } as never,
      })
    ).id;
    await points.updateSettings(org.user, { enabled: true, firstPurchaseEarnPercent: 2, earnPercent: 2, tiersEnabled: true });
    push.transport = async (target, payload) => void pushed.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
  });

  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  beforeEach(() => {
    pushed.length = 0;
  });

  it("a conversation: the customer writes, CRM sees it unread, answers, the phone rings, each side's opening marks the other's messages read", async () => {
    const memberId = await register("+77071000401");
    await expect(chat.reply(org.user, memberId, "Здравствуйте")).rejects.toThrow(/не вошёл в приложение/);
    await signIn(memberId, "+77071000401");
    await push.subscribe(org.organizationId, memberId, { endpoint: `https://fcm.googleapis.com/fcm/send/chat-${memberId}`, p256dh: "p", auth: "a" });

    await expect(chat.sendFromMember(org.organizationId, memberId, "   ")).rejects.toThrow(/Напишите сообщение/);
    await chat.sendFromMember(org.organizationId, memberId, "Можно заказать торт на субботу?");
    const list = await chat.list(org.organizationId);
    expect(list.unread).toBe(1);
    expect(list.items[0]).toMatchObject({ memberId, unread: 1, lastFrom: "CUSTOMER", lastText: "Можно заказать торт на субботу?" });

    // CRM opens the thread: read. The staff member's name is kept for CRM only.
    const opened = await chat.thread(org.organizationId, memberId);
    expect(opened.member).toMatchObject({ inApp: true, notifications: true });
    expect(await chat.unreadForStaff(org.organizationId)).toBe(0);
    const answer = await chat.reply(org.user, memberId, "Да, конечно! Какой вес?");
    expect(answer.byName).toBe(org.user.fullName);
    await flush();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ title: "Ar Amir", body: "Да, конечно! Какой вес?", url: "/app?tab=chat" });

    // The app: one unread, the thread without staff names, then nothing unread.
    expect(await chat.unreadForMember(memberId)).toBe(1);
    const mine = await chat.threadForMember(memberId);
    expect(mine.messages.map((m) => [m.from, m.text, m.byName])).toEqual([
      ["CUSTOMER", "Можно заказать торт на субботу?", null],
      ["BAKERY", "Да, конечно! Какой вес?", null],
    ]);
    expect(await chat.unreadForMember(memberId)).toBe(0);
  });

  it("automatic notices are written into the chat once, and ring the phone", async () => {
    const memberId = await register("+77071000402");
    await signIn(memberId, "+77071000402");
    await push.subscribe(org.organizationId, memberId, { endpoint: `https://fcm.googleapis.com/fcm/send/chat-${memberId}`, p256dh: "p", auth: "a" });
    const sale = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, loyaltyMemberId: memberId, items: [{ productId: bread, quantity: 5, unitPrice: 1000 }] } as never);
    await bot.notifySale(sale as never, null);
    await bot.notifySale(sale as never, null);
    const thread = await chat.threadForMember(memberId);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ from: "BAKERY", kind: "NOTICE", text: expect.stringContaining("Начислено: +100") });
    expect(thread.messages[0].title).toMatch(/Спасибо за покупку/);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload.url).toBe("/app?tab=chat");
  });

  it("a member with the app but silent phones gets the notice in the chat, and the other channels stay open", async () => {
    const memberId = await register("+77071000403");
    await signIn(memberId, "+77071000403");
    expect(await bot.notifyBirthday(memberId, "Айгуль", 500, new Date(Date.now() + 14 * 86_400_000), "birthday:test")).toBe(false);
    expect((await chat.threadForMember(memberId)).messages[0]).toMatchObject({ kind: "NOTICE", title: "С днём рождения, Айгуль! 🎂" });
    expect(pushed).toHaveLength(0);
  });

  it("a mass message goes to a computed group, only to customers with the app", async () => {
    const withApp = await register("+77071000404");
    const withoutApp = await register("+77071000405");
    await signIn(withApp, "+77071000404");
    await prisma.loyaltyMember.update({ where: { id: withApp }, data: { tier: "GOLD" } });
    await prisma.loyaltyMember.update({ where: { id: withoutApp }, data: { tier: "GOLD" } });

    const overview = await chat.overview(org.organizationId);
    expect(overview.audiences.find((a) => a.key === "ALL")!.members).toBe(overview.appMembers);
    expect(overview.audiences.find((a) => a.key === "TIER:GOLD")).toMatchObject({ label: "Уровень: Золото", members: 1 });

    await expect(chat.broadcast(org.user, "TIER:PLATINUM", "Привет")).rejects.toThrow(/пока нет клиентов/);
    await expect(chat.broadcast(org.user, "NOPE", "Привет")).rejects.toThrow(/кому отправить/);
    const sent = await chat.broadcast(org.user, "TIER:GOLD", "Завтра свежие круассаны со скидкой");
    expect(sent).toMatchObject({ audience: "Уровень: Золото", recipients: 1 });
    expect((await chat.threadForMember(withApp)).messages.at(-1)).toMatchObject({ kind: "BROADCAST", text: "Завтра свежие круассаны со скидкой" });
    expect((await chat.threadForMember(withoutApp)).messages).toEqual([]);
    expect((await chat.overview(org.organizationId)).broadcasts[0]).toMatchObject({ id: sent.id, recipients: 1 });
    await flush();
  });
});
