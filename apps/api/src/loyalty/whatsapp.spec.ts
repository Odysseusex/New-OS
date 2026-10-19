import { createHmac } from "node:crypto";
import {
  LoyaltyConsentChannel as Ch,
  LoyaltyConsentPurpose as P,
  LoyaltyConsentSource as S,
  LoyaltyMessageStatus as M,
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
import { WHATSAPP_TEMPLATES, WhatsAppApiError, WhatsAppService, WhatsAppTransport } from "./whatsapp.service";

// WhatsApp against a fake Meta: templates are submitted and approved, a message
// goes out only with consent and an approved template, delivery reports and the
// customer's own «СТОП» / «СТАРТ» come back through the webhook.

type Call = { method: string; path: string; body?: any };

class FakeMeta implements WhatsAppTransport {
  calls: Call[] = [];
  templates = new Map<string, string>();
  fail: { code: number; message: string } | null = null;
  private next = 1;

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    this.calls.push({ method, path, body });
    if (method === "GET" && path.includes("message_templates")) {
      return { data: [...this.templates].map(([name, status]) => ({ name, status, language: "ru" })) };
    }
    if (method === "GET") return { display_phone_number: "+7 700 000 00 00", verified_name: "Ar-Amir", quality_rating: "GREEN" };
    if (path.endsWith("message_templates")) {
      this.templates.set((body as { name: string }).name, "PENDING");
      return { id: "tpl", status: "PENDING" };
    }
    if (this.fail) {
      const f = this.fail;
      this.fail = null;
      throw new WhatsAppApiError(400, f.code, f.message);
    }
    return { messages: [{ id: `wamid.${this.next++}` }] };
  }

  sent(template?: string) {
    return this.calls.filter((c) => c.path.endsWith("messages") && c.body?.type === "template" && (!template || c.body.template.name === template));
  }

  replies() {
    return this.calls.filter((c) => c.path.endsWith("messages") && c.body?.type === "text").map((c) => ({ to: c.body.to, text: c.body.text.body as string }));
  }

  approveAll() {
    for (const name of this.templates.keys()) this.templates.set(name, "APPROVED");
  }
}

describe("WhatsAppService (database, fake Meta)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const whatsapp = new WhatsAppService(prisma);
  const bot = new CustomerBotService(prisma, points, whatsapp);
  const meta = new FakeMeta();
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  const originalSecret = process.env.WHATSAPP_APP_SECRET;
  let org: IsolatedOrg;
  let memberId: string;
  let bread: string;
  const PHONE = "+77093000001";
  const WA_ID = "77093000001";

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    whatsapp.useTransportForTests(meta);
    org = await createIsolatedOrg(prisma, "whatsapp");
    await points.updateSettings(org.user, { enabled: true });
    bread = (
      await prisma.product.create({
        data: { organizationId: org.organizationId, name: "Хлеб", sku: "WA-1", price: 1000, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false } as never,
      })
    ).id;
    memberId = (await loyalty.register(org.user, { phone: PHONE, name: "Айжан", personalDataConsent: true, source: S.AT_TILL })).id;
  });

  afterAll(async () => {
    whatsapp.useTransportForTests(null);
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    if (originalSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = originalSecret;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  const sell = () =>
    services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bread, quantity: 1, unitPrice: 1000 }], loyaltyMemberId: memberId } as never);
  const consent = (granted: boolean) =>
    loyalty.recordConsent(org.user, memberId, { purpose: P.MARKETING, channel: Ch.WHATSAPP, granted, source: S.AT_TILL });
  const incoming = (id: string, text: string, from = WA_ID) =>
    whatsapp.handleWebhook({ entry: [{ changes: [{ field: "messages", value: { messages: [{ id, from, type: "text", text: { body: text } }] } }] }] });
  const report = (id: string, status: string, errors?: object[]) =>
    whatsapp.handleWebhook({ entry: [{ changes: [{ field: "messages", value: { statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), errors }] } }] }] });
  const lastConsent = () => prisma.loyaltyConsent.findFirstOrThrow({ where: { memberId, channel: Ch.WHATSAPP }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });

  it("submits the missing templates to Meta and shows their state", async () => {
    let status = await whatsapp.status(org.organizationId, true);
    expect(status.configured).toBe(true);
    expect(status.templates.every((t) => t.status === "MISSING")).toBe(true);

    const after = await whatsapp.submitTemplates();
    expect(after.every((t) => t.status === "PENDING")).toBe(true);
    const created = meta.calls.filter((c) => c.method === "POST" && c.path.endsWith("message_templates"));
    expect(created.map((c) => c.body.name).sort()).toEqual(Object.values(WHATSAPP_TEMPLATES).map((t) => t.name).sort());
    // No «reply STOP» footer: the owner's decision.
    expect(created.every((c) => c.body.components.length === 1 && c.body.components[0].type === "BODY")).toBe(true);

    // A second press submits nothing new.
    meta.calls.length = 0;
    await whatsapp.submitTemplates();
    expect(meta.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    status = await whatsapp.status(org.organizationId, true);
    expect(status).toMatchObject({ phone: "+7 700 000 00 00", verifiedName: "Ar-Amir", verifyToken: WhatsAppService.verifyToken() });
    expect((await whatsapp.status(org.organizationId, false)).verifyToken).toBeNull();
  });

  it("sends nothing without WhatsApp consent, or while the template is not approved", async () => {
    await points.updateSettings(org.user, { whatsappSaleNotices: true });
    await bot.notifySale(await sell());
    expect(meta.sent()).toHaveLength(0);

    await consent(true);
    await bot.notifySale(await sell());
    expect(meta.sent()).toHaveLength(0);
    expect(await prisma.loyaltyMessageLog.count({ where: { memberId, channel: Ch.WHATSAPP } })).toBe(0);
  });

  it("after a purchase: the approved template, once, to the number without «+»", async () => {
    meta.approveAll();
    whatsapp.useTransportForTests(meta); // drop the cached template states
    const sale = await sell();
    await bot.notifySale(sale);
    await bot.notifySale(sale);
    const sent = meta.sent("ar_purchase_points");
    expect(sent).toHaveLength(1);
    expect(sent[0].body.to).toBe(WA_ID);
    expect(sent[0].body.template.language).toEqual({ code: "ru" });
    expect(sent[0].body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["1 000", "10", "0", expect.any(String)]);
    const log = await prisma.loyaltyMessageLog.findFirstOrThrow({ where: { memberId, key: `wa:sale:${sale.id}` } });
    expect(log).toMatchObject({ channel: Ch.WHATSAPP, status: M.SENT, providerMessageId: expect.stringMatching(/^wamid\./) });
    expect(log.text).toMatch(/^Спасибо за покупку на 1 000 ₸! Начислено баллов: 10/);
  });

  it("the purchase notice is off when its switch is off", async () => {
    await points.updateSettings(org.user, { whatsappSaleNotices: false });
    const before = meta.sent().length;
    await bot.notifySale(await sell());
    expect(meta.sent()).toHaveLength(before);
    await points.updateSettings(org.user, { whatsappSaleNotices: true });
  });

  it("delivery reports move forward only, and show on the member card", async () => {
    const log = await prisma.loyaltyMessageLog.findFirstOrThrow({ where: { memberId, channel: Ch.WHATSAPP, providerMessageId: { not: null } } });
    await report(log.providerMessageId!, "delivered");
    await report(log.providerMessageId!, "read");
    await report(log.providerMessageId!, "delivered");
    expect((await prisma.loyaltyMessageLog.findUniqueOrThrow({ where: { id: log.id } })).status).toBe(M.READ);
    expect((await loyalty.findOne(org.organizationId, memberId)).whatsappLastMessage).toMatchObject({ status: M.READ, error: null });
  });

  it("a temporary failure releases the message so it can be sent later", async () => {
    meta.fail = { code: 131056, message: "pair rate limit" };
    const sale = await sell();
    await bot.notifySale(sale);
    expect(await prisma.loyaltyMessageLog.count({ where: { memberId, key: `wa:sale:${sale.id}` } })).toBe(0);
    await bot.notifySale(sale);
    expect(await prisma.loyaltyMessageLog.findFirst({ where: { memberId, key: `wa:sale:${sale.id}` } })).toMatchObject({ status: M.SENT });
  });

  it("points about to expire: one reminder", async () => {
    await prisma.loyaltyPointsEntry.create({
      data: { organizationId: org.organizationId, memberId, type: T.ADJUSTMENT, points: 40, reason: "тест", expiresAt: new Date(Date.now() + 3 * 86_400_000) },
    });
    expect(await bot.remindExpiringPoints()).toBe(1);
    expect(await bot.remindExpiringPoints()).toBe(0);
    const [sent] = meta.sent("ar_points_expiring");
    expect(sent.body.template.components[0].parameters[0].text).toBe("40");
  });

  it("a message written by the owner goes as the news template, on one line", async () => {
    const result = await bot.sendManual(org.user, [memberId], "Скидка 20% на торты\nтолько в выходные");
    expect(result).toEqual({ sent: 1, skipped: 0 });
    const [sent] = meta.sent("ar_news");
    expect(sent.body.template.components[0].parameters[0].text).toBe("Скидка 20% на торты только в выходные");
  });

  it("WhatsApp comes first even when the member also has the Telegram bot", async () => {
    const telegram: { chatId: string; text: string }[] = [];
    const transport: BotTransport = { send: async (chatId, text) => void telegram.push({ chatId, text }) };
    bot.useTransportForTests(transport);
    try {
      await prisma.loyaltyTelegramLink.create({ data: { organizationId: org.organizationId, memberId, chatId: "1", telegramUserId: "1" } });
      await loyalty.recordConsent(org.user, memberId, { purpose: P.MARKETING, channel: Ch.TELEGRAM, granted: true, source: S.AT_TILL });
      const before = meta.sent().length;
      await bot.notifySale(await sell());
      expect(meta.sent()).toHaveLength(before + 1);
      expect(telegram).toHaveLength(0);

      // A notice WhatsApp does not take (its switch is off) goes to Telegram.
      await points.updateSettings(org.user, { whatsappSaleNotices: false });
      await bot.notifySale(await sell());
      expect(meta.sent()).toHaveLength(before + 1);
      expect(telegram).toHaveLength(1);
      await points.updateSettings(org.user, { whatsappSaleNotices: true });
    } finally {
      bot.useTransportForTests(null);
      await prisma.loyaltyTelegramLink.deleteMany({ where: { memberId } });
    }
  });

  it("a customer's message gets their balance; СТОП and СТАРТ are their consent", async () => {
    await incoming("in.1", "Сколько у меня баллов?");
    expect(meta.replies().at(-1)).toMatchObject({ to: WA_ID, text: expect.stringMatching(/^На счёте: .+ баллов/) });
    expect(meta.replies().at(-1)?.text).not.toMatch(/СТОП|отпис/i);

    await incoming("in.2", "Стоп");
    await incoming("in.2", "Стоп"); // Meta may repeat a delivery
    expect(await lastConsent()).toMatchObject({ granted: false, source: S.WHATSAPP, recordedByName: "Клиент (WhatsApp)" });
    expect(meta.replies().filter((r) => r.text.startsWith("Вы отписались"))).toHaveLength(1);
    const before = meta.sent().length;
    await bot.notifySale(await sell());
    expect(meta.sent()).toHaveLength(before);

    await incoming("in.3", "СТАРТ");
    expect(await lastConsent()).toMatchObject({ granted: true, source: S.WHATSAPP });

    await incoming("in.4", "привет", "77093999999");
    expect(meta.replies().at(-1)?.text).toMatch(/не зарегистрирован/);
  });

  it("«stop marketing» in WhatsApp, or Meta's 131050, is a withdrawal", async () => {
    meta.fail = { code: 131050, message: "user stopped marketing" };
    const sale = await sell();
    await bot.notifySale(sale);
    expect(await prisma.loyaltyMessageLog.findFirst({ where: { memberId, key: `wa:sale:${sale.id}` } })).toMatchObject({
      status: M.FAILED,
      error: "Клиент отключил сообщения от компаний в WhatsApp",
    });
    expect(await lastConsent()).toMatchObject({ granted: false, source: S.WHATSAPP });

    await incoming("in.5", "старт");
    await whatsapp.handleWebhook({ entry: [{ changes: [{ field: "user_preferences", value: { user_preferences: [{ wa_id: WA_ID, category: "marketing_messages", value: "stop" }] } }] }] });
    expect(await lastConsent()).toMatchObject({ granted: false });
  });

  it("webhook: Meta's handshake and the signature over the raw body", () => {
    const token = WhatsAppService.verifyToken();
    expect(whatsapp.verifySubscription("subscribe", token, "12345")).toBe("12345");
    expect(whatsapp.verifySubscription("subscribe", "wrong", "12345")).toBeNull();
    const raw = Buffer.from(JSON.stringify({ entry: [], note: "é" }));
    const good = `sha256=${createHmac("sha256", "test-app-secret").update(raw).digest("hex")}`;
    expect(WhatsAppService.checkSignature(raw, good)).toBe(true);
    expect(WhatsAppService.checkSignature(Buffer.from(`${raw} `), good)).toBe(false);
    expect(WhatsAppService.checkSignature(raw, undefined)).toBe(false);
  });
});
