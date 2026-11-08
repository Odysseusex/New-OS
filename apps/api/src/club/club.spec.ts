import {
  cardCodeStep,
  cardPayload,
  LoyaltyConsentPurpose as P,
  LoyaltyConsentSource as S,
  parseCardPayload,
  PaymentMethod,
  ProductType,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { LoyaltyPointsService } from "../loyalty/loyalty-points.service";
import { LoyaltyService } from "../loyalty/loyalty.service";
import { CustomerBotService } from "../loyalty/customer-bot.service";
import { WhatsAppService } from "../loyalty/whatsapp.service";
import { cardCodeAt, cardCodeValid, confirmClubLogin } from "./club-confirm";
import { verifyClubToken } from "./club-token";
import { ClubService } from "./club.service";

describe("card code (rotating QR)", () => {
  it("is six digits, changes every 30 s and is accepted a minute either side", () => {
    const secret = "a".repeat(40);
    const now = Date.UTC(2026, 10, 7, 10, 0, 15);
    const step = cardCodeStep(now);
    const code = cardCodeAt(secret, step);
    expect(code).toMatch(/^\d{6}$/);
    expect(cardCodeAt(secret, step + 1)).not.toBe(code);
    expect(cardCodeValid(secret, code, now + 60_000)).toBe(true);
    expect(cardCodeValid(secret, code, now + 5 * 60_000)).toBe(false);
    expect(cardCodeValid("b".repeat(40), code, now)).toBe(false);
  });

  it("the QR holds digits only: the phone then the code", () => {
    const payload = cardPayload("+77014035832", "048291");
    expect(payload).toBe("7014035832048291");
    expect(parseCardPayload(payload)).toEqual({ phone: "+77014035832", code: "048291" });
    expect(parseCardPayload(" 7014035832048291\n")).toEqual({ phone: "+77014035832", code: "048291" });
    expect(parseCardPayload("9014035832048291")).toBeNull();
    expect(parseCardPayload("70140358320482")).toBeNull();
  });
});

describe("customer app sign-in and card (database)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const whatsapp = new WhatsAppService(prisma);
  const fakeWhatsApp = { businessPhoneDigits: async () => "77010000000" } as unknown as WhatsAppService;
  const fakeBot = { botUsername: () => "ArAmirBonusBot" } as unknown as CustomerBotService;
  const club = new ClubService(prisma, points, fakeWhatsApp, fakeBot);
  const bot = new CustomerBotService(prisma, points);
  const originalOrg = process.env.CLUB_ORGANIZATION_ID;
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  let org: IsolatedOrg;
  let bread: string;

  const start = (phone: string, extra: object = {}) => club.startLogin({ phone, name: "Айгуль", consent: true, marketing: true, ...extra });
  const signIn = async (phone: string) => {
    const started = await start(phone);
    await confirmClubLogin(prisma, { phone, text: `Код входа: ${started.code}`, channel: "WHATSAPP" });
    const status = await club.loginStatus(started.requestId, started.secret);
    return club.session(verifyClubToken(status.token!)!.sid);
  };

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    org = await createIsolatedOrg(prisma, "club-app");
    process.env.CLUB_ORGANIZATION_ID = org.organizationId;
    bread = (
      await prisma.product.create({
        data: { organizationId: org.organizationId, name: "Хлеб", sku: "CL-1", price: 600, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false },
      })
    ).id;
  });

  afterAll(async () => {
    if (originalOrg === undefined) delete process.env.CLUB_ORGANIZATION_ID;
    else process.env.CLUB_ORGANIZATION_ID = originalOrg;
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("sign-in is refused while the programme is off, without consent, or for a non-Kazakh number", async () => {
    await expect(start("+77071230001")).rejects.toThrow(/недоступен/);
    await points.updateSettings(org.user, { enabled: true });
    await expect(start("+77071230001", { consent: false })).rejects.toThrow(/согласия/);
    await expect(start("+79161234567")).rejects.toThrow(/казахстанский/);
  });

  it("a message from ANOTHER number does not sign anyone in; one from the typed number does, once", async () => {
    const started = await start("+77071230002");
    expect(started.code).toMatch(/^\d{6}$/);
    expect(started.whatsappUrl).toContain("wa.me/77010000000");
    expect(decodeURIComponent(started.whatsappUrl!)).toContain(started.code);
    expect(started.telegramUrl).toBe(`https://t.me/ArAmirBonusBot?start=in_${started.code}`);
    expect(await club.loginStatus(started.requestId, started.secret)).toEqual({ status: "PENDING" });

    const stranger = await confirmClubLogin(prisma, { phone: "+77079999999", text: started.code, channel: "WHATSAPP" });
    expect(stranger).toMatchObject({ matched: true, ok: false });
    expect(await club.loginStatus(started.requestId, started.secret)).toEqual({ status: "PENDING" });
    await expect(club.loginStatus(started.requestId, "wrong-secret")).rejects.toThrow(/не найден/);

    const owner = await confirmClubLogin(prisma, { phone: "+77071230002", text: `Код входа в приложение Ar Amir: ${started.code}`, channel: "WHATSAPP" });
    expect(owner).toMatchObject({ matched: true, ok: true });
    const first = await club.loginStatus(started.requestId, started.secret);
    expect(first.status).toBe("CONFIRMED");
    expect(first.token).toBeTruthy();
    expect(await club.loginStatus(started.requestId, started.secret)).toEqual({ status: "USED" });

    // A first-time customer is registered with the consent given in the app.
    const member = await prisma.loyaltyMember.findUniqueOrThrow({
      where: { organizationId_phone: { organizationId: org.organizationId, phone: "+77071230002" } },
      include: { consents: true },
    });
    expect(member.name).toBe("Айгуль");
    expect(member.cardSecret).toBeTruthy();
    expect(member.consents.map((c) => [c.purpose, c.channel, c.granted, c.source]).sort()).toEqual([
      [P.MARKETING, "WHATSAPP", true, S.CUSTOMER_APP],
      [P.PERSONAL_DATA, null, true, S.CUSTOMER_APP],
    ]);
  });

  it("an unrelated message is not taken for a sign-in; a stale code gets a plain answer", async () => {
    expect(await confirmClubLogin(prisma, { phone: "+77071230002", text: "Сколько у меня баллов?", channel: "WHATSAPP" })).toEqual({ matched: false });
    expect(await confirmClubLogin(prisma, { phone: "+77071230002", text: "Код входа в приложение Ar Amir: 000000", channel: "WHATSAPP" })).toMatchObject({
      matched: true,
      ok: false,
    });
  });

  it("the card shows purchases and points; the till finds the member by the scanned code", async () => {
    const session = await signIn("+77071230003");
    const before = await club.profile(session);
    expect(before.balance).toBe(0);
    await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      loyaltyMemberId: session.memberId,
      items: [{ productId: bread, quantity: 2, unitPrice: 600 }],
    } as never);
    const after = await club.profile(session);
    expect(after.visits).toBe(1);
    expect(after.history[0]).toMatchObject({ kind: "PURCHASE", amount: 1200, points: 60 });
    expect(after.balance).toBe(60);

    const code = cardCodeAt(after.card.secret, cardCodeStep(Date.now()));
    const found = await loyalty.lookupCard(org.organizationId, cardPayload("+77071230003", code));
    expect(found.member?.id).toBe(session.memberId);
    await expect(loyalty.lookupCard(org.organizationId, cardPayload("+77071230003", code === "000000" ? "111111" : "000000"))).rejects.toThrow(/устарел/);
    await expect(loyalty.lookupCard(org.organizationId, "hello")).rejects.toThrow(/не карта/);
  });

  it("a customer registered at the till signs in to the same record, without a duplicate consent", async () => {
    const tillMember = await loyalty.register(org.user, { phone: "+77071230004", name: "Ерлан", personalDataConsent: true, marketingChannels: ["WHATSAPP"], source: S.AT_TILL } as never);
    const session = await signIn("+77071230004");
    expect(session.memberId).toBe(tillMember.id);
    const consents = await prisma.loyaltyConsent.findMany({ where: { memberId: tillMember.id } });
    expect(consents.filter((c) => c.source === S.CUSTOMER_APP)).toEqual([]);
    expect((await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: tillMember.id } })).name).toBe("Ерлан");
  });

  it("signing out ends the session; a withdrawn consent closes the app until they agree again", async () => {
    const session = await signIn("+77071230005");
    await club.logout(session);
    await expect(club.session(session.sessionId)).rejects.toThrow(/Войдите заново/);

    const again = await signIn("+77071230005");
    await loyalty.recordConsent(org.user, again.memberId, { purpose: P.PERSONAL_DATA, granted: false, source: S.AT_TILL } as never);
    await expect(club.session(again.sessionId)).rejects.toThrow(/отозвали/);
    const back = await signIn("+77071230005");
    expect(back.memberId).toBe(again.memberId);
    expect((await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: back.memberId } })).status).toBe("ACTIVE");
  });

  it("too many sign-in attempts for one number are refused", async () => {
    for (let i = 0; i < 5; i += 1) await start("+77071230006");
    await expect(start("+77071230006")).rejects.toThrow(/Слишком много/);
  });

  it("WhatsApp: the customer's message to our number signs them in", async () => {
    const started = await start("+77071230007");
    await whatsapp.handleWebhook({
      entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "wamid.club1", from: "77071230007", text: { body: `Код входа в приложение Ar Amir: ${started.code}` } }] } }] }],
    });
    expect((await club.loginStatus(started.requestId, started.secret)).status).toBe("CONFIRMED");
  });

  it("Telegram: the deep link waits for the customer's own contact", async () => {
    const started = await start("+77071230008");
    await bot.onStart("tg-chat-club", `in_${started.code}`);
    const reply = await bot.onContact("tg-chat-club", "555", { phone_number: "+77071230008", user_id: 555 });
    expect(reply.text).toMatch(/Вход подтверждён/);
    expect((await club.loginStatus(started.requestId, started.secret)).status).toBe("CONFIRMED");
    await prisma.loyaltyTelegramLink.deleteMany({ where: { chatId: "tg-chat-club" } });
  });
});
