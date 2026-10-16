import {
  LoyaltyConsentChannel as Ch,
  LoyaltyConsentPurpose as P,
  LoyaltyConsentSource as S,
  LoyaltyPointsEntryType as T,
  PaymentMethod,
  ProductType,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { BotTransport, CustomerBotService } from "./customer-bot.service";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";

// The customer Telegram bot, driven without Telegram: a member links by sharing
// their own number, opts in with a button, and is messaged only while consented.

describe("CustomerBotService (database)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const bot = new CustomerBotService(prisma, points);
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  const outbox: { chatId: string; text: string }[] = [];
  let failWith: number | null = null;
  const transport: BotTransport = {
    send: async (chatId, text) => {
      if (failWith) throw Object.assign(new Error("telegram"), { response: { error_code: failWith } });
      outbox.push({ chatId, text });
    },
  };
  let org: IsolatedOrg;
  let memberId: string;
  let bread: string;
  const CHAT = "5550001";
  const TG_USER = "777001";
  const PHONE = "+77091000001";

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    bot.useTransportForTests(transport);
    org = await createIsolatedOrg(prisma, "customer-bot");
    await points.updateSettings(org.user, { enabled: true });
    bread = (
      await prisma.product.create({
        data: { organizationId: org.organizationId, name: "Хлеб", sku: "CB-1", price: 1000, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false } as never,
      })
    ).id;
    memberId = (await loyalty.register(org.user, { phone: PHONE, name: "Айжан", personalDataConsent: true, source: S.AT_TILL })).id;
  });

  afterAll(async () => {
    bot.useTransportForTests(null);
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  const sell = () =>
    services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bread, quantity: 1, unitPrice: 1000 }], loyaltyMemberId: memberId } as never);

  it("asks an unknown chat for its phone", async () => {
    expect((await bot.onStart(CHAT)).text).toMatch(/отправить свой номер/);
  });

  it("refuses a forwarded contact and a number not in the programme", async () => {
    expect((await bot.onContact(CHAT, TG_USER, { phone_number: PHONE, user_id: 999 })).text).toMatch(/свой номер/);
    expect((await bot.onContact(CHAT, TG_USER, { phone_number: "+77091999999", user_id: Number(TG_USER) })).text).toMatch(/не зарегистрирован/);
    expect(await prisma.loyaltyTelegramLink.count({ where: { organizationId: org.organizationId } })).toBe(0);
  });

  it("links by the member's own number, then asks for consent; nothing is sent before it", async () => {
    const reply = await bot.onContact(CHAT, TG_USER, { phone_number: "87091000001", user_id: Number(TG_USER) });
    expect(reply.text).toMatch(/Присылать вам сюда уведомления/);
    expect(await prisma.loyaltyTelegramLink.findUnique({ where: { memberId } })).toMatchObject({ chatId: CHAT });

    outbox.length = 0;
    const sale = await sell();
    await bot.notifySale(sale);
    expect(outbox).toHaveLength(0);
  });

  it("«Да» records the TELEGRAM consent as the customer's own decision", async () => {
    expect((await bot.setSubscription(CHAT, true)).text).toMatch(/включены/);
    const row = await prisma.loyaltyConsent.findFirstOrThrow({ where: { memberId, channel: Ch.TELEGRAM }, orderBy: { recordedAt: "desc" } });
    expect(row).toMatchObject({ purpose: P.MARKETING, granted: true, source: S.TELEGRAM_BOT, recordedByName: "Клиент (Telegram)" });
    expect((await loyalty.findOne(org.organizationId, memberId)).telegramLinked).toBe(true);
  });

  it("after a sale: what was earned and the balance, once per sale", async () => {
    outbox.length = 0;
    const sale = await sell();
    await bot.notifySale(sale);
    await bot.notifySale(sale);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].chatId).toBe(CHAT);
    expect(outbox[0].text).toMatch(/Начислено: \+10/);
    expect(outbox[0].text).toMatch(/На счёте: <b>/);
  });

  it("«Мои баллы» shows the balance and the nearest expiry", async () => {
    const reply = await bot.onBalance(CHAT);
    expect(reply.text).toMatch(/На счёте: <b>/);
    expect(reply.text).toMatch(/сгорят/);
  });

  it("reminds once about points that expire within a week", async () => {
    await prisma.loyaltyPointsEntry.create({
      data: { organizationId: org.organizationId, memberId, type: T.ADJUSTMENT, points: 40, reason: "тест", expiresAt: new Date(Date.now() + 3 * 86_400_000) },
    });
    outbox.length = 0;
    expect(await bot.remindExpiringPoints()).toBe(1);
    expect(outbox[0].text).toMatch(/40 ваших баллов сгорят/);
    expect(await bot.remindExpiringPoints()).toBe(0);
  });

  it("a written message reaches only consented members", async () => {
    const other = (await loyalty.register(org.user, { phone: "+77091000002", personalDataConsent: true, source: S.AT_TILL })).id;
    outbox.length = 0;
    const result = await bot.sendManual(org.user, [memberId, other], "Ждём вас <завтра>!");
    expect(result).toEqual({ sent: 1, skipped: 1 });
    expect(outbox[0].text).toBe("Ждём вас &lt;завтра&gt;!");
  });

  it("«Отписаться» stops every message", async () => {
    await bot.setSubscription(CHAT, false);
    outbox.length = 0;
    expect(await bot.sendManual(org.user, [memberId], "Тест рассылки")).toEqual({ sent: 0, skipped: 1 });
    expect(outbox).toHaveLength(0);
  });

  it("blocking the bot unlinks the chat and records the withdrawal", async () => {
    await bot.setSubscription(CHAT, true);
    failWith = 403;
    expect(await bot.sendManual(org.user, [memberId], "Тест после блокировки")).toEqual({ sent: 0, skipped: 1 });
    failWith = null;
    expect(await prisma.loyaltyTelegramLink.findUnique({ where: { memberId } })).toBeNull();
    const last = await prisma.loyaltyConsent.findFirstOrThrow({ where: { memberId, channel: Ch.TELEGRAM }, orderBy: { recordedAt: "desc" } });
    expect(last).toMatchObject({ granted: false, note: "Клиент заблокировал бота" });
  });

  it("a member who withdrew personal-data consent cannot link", async () => {
    await loyalty.recordConsent(org.user, memberId, { purpose: P.PERSONAL_DATA, granted: false, source: S.AT_TILL });
    expect((await bot.onContact(CHAT, TG_USER, { phone_number: PHONE, user_id: Number(TG_USER) })).text).toMatch(/отозвали согласие/);
  });
});
