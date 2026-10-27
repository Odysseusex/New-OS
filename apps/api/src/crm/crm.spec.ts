import {
  CrmContactChannel,
  CrmContactOutcome,
  CrmContactReason,
  CrmOrderStage,
  LoyaltyConsentChannel,
  LoyaltyConsentSource as S,
  medianInterval,
  PaymentMethod,
  ProductType,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { LoyaltyAnalyticsService } from "../loyalty/loyalty-analytics.service";
import { LoyaltyBirthdayService } from "../loyalty/loyalty-birthday.service";
import { LoyaltyPointsService } from "../loyalty/loyalty-points.service";
import { LoyaltyService } from "../loyalty/loyalty.service";
import { CrmOrdersService } from "./crm-orders.service";
import { CrmService } from "./crm.service";
import { DAY, retailVerdict, rhythmPosition, suggestedText, usualProducts, wholesaleVerdict } from "./rhythm";

const today = Date.UTC(2026, 9, 20) - 5 * 3600_000; // an Almaty midnight
const days = (...ago: number[]) => ago.map((a) => today - a * DAY);

describe("rhythm (pure)", () => {
  it("the rhythm is the median gap and needs three purchase days", () => {
    expect(medianInterval(days(9, 6))).toBeNull();
    expect(medianInterval(days(12, 9, 6, 3))).toBe(3);
    expect(medianInterval(days(30, 9, 6, 3))).toBe(3); // one long gap does not move the median
    expect(medianInterval(days(5, 5, 5, 2))).toBeNull(); // same day twice is one visit
  });

  it("due when a day or more late, lapsed when far past, nothing for an irregular buyer", () => {
    expect(retailVerdict(rhythmPosition(days(12, 9, 6, 3), today))).toBeNull(); // exactly on time
    expect(retailVerdict(rhythmPosition(days(14, 11, 8, 5), today))).toBe("DUE"); // 2 days late
    expect(retailVerdict(rhythmPosition(days(40, 37, 34, 31), today))).toBe("LAPSED"); // 31 days, rhythm 3
    expect(retailVerdict(rhythmPosition(days(300, 297, 294, 291), today))).toBeNull(); // gone, not chased
    expect(retailVerdict(rhythmPosition(days(200, 140, 80), today))).toBeNull(); // a 60-day rhythm is no habit
    expect(wholesaleVerdict(rhythmPosition(days(30, 23, 16, 9), today))).toBe(true); // weekly, 2 days late
  });

  it("usual products by purchase occasions, wholesale with the average quantity", () => {
    const o = [
      { saleId: "1", name: "Багет", quantity: 1 },
      { saleId: "2", name: "Багет", quantity: 2 },
      { saleId: "2", name: "Круассан", quantity: 1 },
      { saleId: "3", name: "Батон", quantity: 40 },
      { saleId: "4", name: "Батон", quantity: 42 },
    ];
    expect(usualProducts(o, 2)).toEqual(["Багет", "Батон"]);
    expect(usualProducts(o.slice(3), 1, true)).toEqual(["Батон ×41"]);
  });

  it("the suggested message names the person and what they buy", () => {
    expect(suggestedText("DUE", { brand: "Ар Амир", name: "Айгуль Нурланова", usual: ["Багет"], points: 0 })).toBe(
      "Айгуль, добрый день! Это «Ар Амир». Багет сегодня из печи — отложить для вас?",
    );
    expect(suggestedText("LAPSED", { brand: "Ар Амир", name: null, usual: [], points: 240 })).toContain("240 бонусных баллов");
    expect(suggestedText("BIRTHDAY", { brand: "Ар Амир", name: "Гульнара", usual: [], points: 0, birthdayOf: { name: "Тимур", relation: "Сын", isHolder: false } })).toContain(
      "день рождения — Тимур (сын)",
    );
  });
});

describe("CrmService (database)", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const crm = new CrmService(prisma, loyalty, points, new LoyaltyAnalyticsService(prisma));
  const orders = new CrmOrdersService(prisma);
  const birthdays = new LoyaltyBirthdayService(prisma, points);
  const originalFiscal = process.env.FISCALIZATION_ENABLED;
  let org: IsolatedOrg;

  beforeAll(async () => {
    await prisma.$connect();
    delete process.env.FISCALIZATION_ENABLED;
    org = await createIsolatedOrg(prisma, "crm");
  });

  afterAll(async () => {
    if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
    else process.env.FISCALIZATION_ENABLED = originalFiscal;
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("builds the board from real sales, honours consent, and moves a contacted card to «done»", async () => {
    await points.updateSettings(org.user, { enabled: true });
    const now = new Date();
    const mk = (name: string, sku: string) =>
      prisma.product.create({ data: { organizationId: org.organizationId, name, sku, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, trackInventory: false, price: 500 } as never });
    const bread = (await mk("Багет", "CRM-1")).id;
    const bun = (await mk("Батон", "CRM-2")).id;
    const reg = async (phone: string, name: string, channels: LoyaltyConsentChannel[]) =>
      (await loyalty.register(org.user, { phone, name, personalDataConsent: true, marketingChannels: channels, source: S.AT_TILL })).id;
    const regular = await reg("+77082000001", "Айгуль Нурланова", [LoyaltyConsentChannel.WHATSAPP]);
    const silent = await reg("+77082000002", "Без согласия", []);
    const wholesaleCustomer = await prisma.customer.create({ data: { organizationId: org.organizationId, name: "Мерей", phone: "+77750000000" } });

    const sellAgo = async (ago: number, extra: object, productId: string, quantity = 1) => {
      const sale = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId, quantity, unitPrice: 500 }], ...extra } as never);
      await prisma.sale.update({ where: { id: sale.id }, data: { soldAt: new Date(now.getTime() - ago * DAY) } });
    };
    for (const ago of [14, 11, 8, 5]) {
      await sellAgo(ago, { loyaltyMemberId: regular }, bread);
      await sellAgo(ago, { loyaltyMemberId: silent }, bread);
    }
    for (const ago of [30, 23, 16, 9]) await sellAgo(ago, { customerId: wholesaleCustomer.id, paymentMethod: PaymentMethod.TRANSFER }, bun, 40);
    const inThreeDays = new Date(now.getTime() + 3 * DAY);
    const [, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(inThreeDays).split("-").map(Number);
    await birthdays.add(org.user, regular, { name: "Алихан", relation: "сын", birthDay: d, birthMonth: m } as never);

    const board = await crm.today(org.organizationId, now);
    expect(board.due.map((c) => c.memberId)).toEqual([regular]); // the one without consent is not offered
    expect(board.due[0]).toMatchObject({ rhythmDays: 3, overdueDays: 2, usual: ["Багет"], channels: { whatsapp: true, call: true } });
    expect(board.due[0].suggestedText).toMatch(/^Айгуль, добрый день!/);
    expect(board.wholesale[0]).toMatchObject({ customerId: wholesaleCustomer.id, rhythmDays: 7, usual: ["Батон ×40"] });
    expect(board.birthdays[0]).toMatchObject({ memberId: regular, birthday: { name: "Алихан", inDays: 3 } });

    await crm.recordContact(org.user, { memberId: regular, channel: CrmContactChannel.WHATSAPP, outcome: CrmContactOutcome.SENT, reason: CrmContactReason.DUE });
    const after = await crm.today(org.organizationId, now);
    expect(after.due).toEqual([]);
    expect(after.done.map((c) => c.key)).toEqual([`member:${regular}`]);
    expect(after.birthdays).toHaveLength(1); // a «пора за покупкой» message is not the birthday one

    // The next purchase after the message counts as «вернулся».
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bread, quantity: 2, unitPrice: 500 }], loyaltyMemberId: regular } as never);
    const later = await crm.today(org.organizationId, new Date(now.getTime() + 60_000));
    expect(later.stats).toMatchObject({ contacts30: 1, returned30: 1, returnedRevenue30: 1000 });

    const list = await crm.list(org.organizationId, { sort: "spend" });
    expect(list.items[0]).toMatchObject({ id: regular, visits: 5, whatsapp: true });

    const card = await crm.profile(org.organizationId, regular);
    expect(card.stats.visits).toBe(5);
    expect(card.favorites[0]).toMatchObject({ name: "Багет", share: 1 });
    expect(card.timeline.map((t) => t.kind)).toEqual(expect.arrayContaining(["SALE", "CONTACT", "CONSENT", "REGISTERED"]));
  });

  it("orders: numbered per organization, stage changes are recorded", async () => {
    const due = new Date(Date.now() + 5 * DAY).toISOString();
    const a = await orders.create(org.user, { customerName: "Гульнара", title: "Торт «Медовик», 2 кг", dueAt: due, price: 17400 });
    const b = await orders.create(org.user, { customerName: "Асель", title: "Наполеон", dueAt: due });
    expect([a.number, b.number]).toEqual([1, 2]);
    const moved = await orders.update(org.user, a.id, { stage: CrmOrderStage.PREPAID });
    expect(moved).toMatchObject({ stage: CrmOrderStage.PREPAID, prepaid: true });
    expect(moved.events.map((e) => e.toStage)).toEqual([CrmOrderStage.NEW, CrmOrderStage.PREPAID]);
    await expect(orders.create(org.user, { customerName: " ", title: "x", dueAt: due })).rejects.toThrow(/имя заказчика/);
    await expect(orders.update(org.user, a.id, { price: -1 })).rejects.toThrow(/больше нуля/);
    expect((await orders.list(org.organizationId)).map((o) => o.number)).toEqual([1, 2]);
  });
});
