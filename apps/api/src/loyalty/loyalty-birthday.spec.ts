import { LoyaltyConsentSource as S, LoyaltyPointsEntryType as T } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { currentBirthday, giftEligible, localMidnight, nextBirthday } from "./birthdays";
import { LoyaltyBirthdayService } from "./loyalty-birthday.service";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyService } from "./loyalty.service";

const DAY = 86_400_000;
// Noon in Almaty on a calendar date.
const at = (y: number, m: number, d: number) => new Date(localMidnight(y, m, d).getTime() + 12 * 3_600_000);

describe("birthday dates (pure)", () => {
  it("Feb 29 falls on Feb 28 in a common year", () => {
    expect(nextBirthday(at(2027, 2, 1), 2, 29).at).toEqual(localMidnight(2027, 2, 28));
    expect(nextBirthday(at(2028, 2, 1), 2, 29).at).toEqual(localMidnight(2028, 2, 29));
  });

  it("a birthday is current on the day and for a week after, across New Year", () => {
    expect(currentBirthday(at(2026, 5, 10), 5, 10)?.year).toBe(2026);
    expect(currentBirthday(at(2026, 5, 17), 5, 10)?.year).toBe(2026);
    expect(currentBirthday(at(2026, 5, 19), 5, 10)).toBeNull();
    expect(currentBirthday(at(2026, 5, 9), 5, 10)).toBeNull();
    expect(currentBirthday(at(2027, 1, 2), 12, 30)?.year).toBe(2026);
  });

  it("the 30-day rule", () => {
    const bday = localMidnight(2026, 6, 1);
    expect(giftEligible(new Date(bday.getTime() - 31 * DAY), bday)).toBe(true);
    expect(giftEligible(new Date(bday.getTime() - 5 * DAY), bday)).toBe(false);
  });
});

describe("LoyaltyBirthdayService (database)", () => {
  const prisma = new PrismaService();
  const points = new LoyaltyPointsService(prisma);
  const loyalty = new LoyaltyService(prisma, points);
  const sent: { memberId: string; name: string; points: number; lastDay: Date; key: string }[] = [];
  const bot = {
    notifyBirthday: async (memberId: string, name: string, points: number, lastDay: Date, key: string) => (sent.push({ memberId, name, points, lastDay, key }), true),
  };
  const birthdays = new LoyaltyBirthdayService(prisma, points, bot as never);
  let org: IsolatedOrg;
  let memberId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "loyalty-birthday");
    memberId = (await loyalty.register(org.user, { phone: "+77092000001", name: "Айгуль", personalDataConsent: true, source: S.AT_TILL })).id;
  });

  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  const backdate = (id: string, days: number) =>
    prisma.loyaltyFamilyMember.update({ where: { id }, data: { dateSetAt: new Date(Date.now() - days * DAY) } });

  it("several birthdays on one card, shown on the card, with a limit", async () => {
    const mum = await birthdays.add(org.user, memberId, { name: "Айгуль", relation: "Сама", birthDay: 10, birthMonth: 3 });
    await birthdays.add(org.user, memberId, { name: "Дамир", relation: "Сын", birthDay: 29, birthMonth: 2, birthYear: 2016 });
    const card = await loyalty.findOne(org.organizationId, memberId);
    expect(card.family.map((f) => f.name)).toEqual(["Айгуль", "Дамир"]);
    expect(card.family[0]).toMatchObject({ id: mum.id, relation: "Сама", giftEligibleNext: true });

    await expect(birthdays.add(org.user, memberId, { name: "X", birthDay: 31, birthMonth: 4 })).rejects.toThrow(/Неверная дата/);
    await expect(birthdays.add(org.user, memberId, { name: "X", birthDay: 29, birthMonth: 2, birthYear: 2023 })).rejects.toThrow(/Неверная дата/);
    await expect(birthdays.add(org.user, memberId, { name: " ", birthDay: 1, birthMonth: 1 })).rejects.toThrow(/имя/);

    for (let i = 0; i < 6; i++) await birthdays.add(org.user, memberId, { name: `Гость ${i}`, birthDay: 1, birthMonth: 1 });
    await expect(birthdays.add(org.user, memberId, { name: "Девятый", birthDay: 1, birthMonth: 1 })).rejects.toThrow(/не больше 8/);
    const extra = await prisma.loyaltyFamilyMember.findMany({ where: { memberId, name: { startsWith: "Гость" } } });
    for (const row of extra) await birthdays.remove(org.user, row.id);
    expect((await loyalty.findOne(org.organizationId, memberId)).family).toHaveLength(2);
  });

  it("no gift while the programme or the gift is off", async () => {
    const row = await birthdays.add(org.user, memberId, { name: "Off", birthDay: 15, birthMonth: 7 });
    await backdate(row.id, 400);
    expect(await birthdays.grantDue(at(2026, 7, 15), org.organizationId)).toBe(0);
    await points.updateSettings(org.user, { enabled: true });
    expect(await birthdays.grantDue(at(2026, 7, 15), org.organizationId)).toBe(0);
    await birthdays.remove(org.user, row.id);
  });

  it("gives the gift once per birthday, expiring after the set days, and says so in Telegram", async () => {
    await points.updateSettings(org.user, { enabled: true, birthdayBonusPoints: 500, birthdayBonusDays: 14 });
    const row = await birthdays.add(org.user, memberId, { name: "Алия", relation: "Дочь", birthDay: 20, birthMonth: 8 });
    await backdate(row.id, 400);
    sent.length = 0;

    const day = at(2026, 8, 22); // two days late: the server slept
    expect(await birthdays.grantDue(day, org.organizationId)).toBe(1);
    expect(await birthdays.grantDue(day, org.organizationId)).toBe(0);
    const entry = await prisma.loyaltyPointsEntry.findFirstOrThrow({ where: { memberId, type: T.BIRTHDAY } });
    expect(entry.points.toNumber()).toBe(500);
    expect(entry.expiresAt).toEqual(new Date(localMidnight(2026, 8, 20).getTime() + 14 * DAY));
    expect(entry.reason).toBe("День рождения: Алия");
    // The last day it can be spent is the day before it expires (2 September).
    expect(sent).toEqual([{ memberId, name: "Алия", points: 500, lastDay: new Date(entry.expiresAt!.getTime() - 1), key: `birthday:${row.id}:2026` }]);
    expect((await loyalty.findOne(org.organizationId, memberId)).family.find((f) => f.id === row.id)?.lastGiftYear).toBe(2026);
    await birthdays.remove(org.user, row.id);
  });

  it("a date added (or changed) less than 30 days before brings no gift that year", async () => {
    const row = await birthdays.add(org.user, memberId, { name: "Поздно", birthDay: 25, birthMonth: 12 });
    await prisma.loyaltyFamilyMember.update({ where: { id: row.id }, data: { dateSetAt: new Date(localMidnight(2026, 12, 10)) } });
    expect(await birthdays.grantDue(at(2026, 12, 25), org.organizationId)).toBe(0);

    await backdate(row.id, 400);
    await birthdays.update(org.user, row.id, { name: "Поздно", birthDay: 26, birthMonth: 12 });
    const fresh = await prisma.loyaltyFamilyMember.findUniqueOrThrow({ where: { id: row.id } });
    expect(Date.now() - fresh.dateSetAt.getTime()).toBeLessThan(60_000);
    await birthdays.remove(org.user, row.id);
  });

  it("birthdays move to the primary card on merge", async () => {
    const dup = (await loyalty.register(org.user, { phone: "+77092000002", personalDataConsent: true, source: S.AT_TILL })).id;
    await birthdays.add(org.user, dup, { name: "Бабушка", birthDay: 5, birthMonth: 5 });
    await loyalty.merge(org.user, { primaryId: memberId, duplicateId: dup, reason: "новый номер" });
    expect((await loyalty.findOne(org.organizationId, memberId)).family.map((f) => f.name)).toContain("Бабушка");
    await expect(birthdays.add(org.user, dup, { name: "X", birthDay: 1, birthMonth: 1 })).rejects.toThrow(/объединена/);
  });
});
