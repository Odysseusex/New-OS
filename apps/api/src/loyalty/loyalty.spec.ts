import { Reflector } from "@nestjs/core";
import {
  formatKzPhone,
  LoyaltyConsentChannel as Ch,
  LoyaltyConsentPurpose as P,
  LoyaltyConsentSource as S,
  LoyaltyImportRowStatus,
  LoyaltyMemberStatus,
  normalizeKzPhone,
  Role,
} from "@bakery-os/shared";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { LoyaltyController } from "./loyalty.controller";
import { LoyaltyService } from "./loyalty.service";

// Loyalty stage 1: a retail customer found by phone at the till, and an
// append-only record of what they agreed to. No points, no money.

describe("normalizeKzPhone", () => {
  it.each([
    ["+7 701 123 45 67", "+77011234567"],
    ["8 (701) 123-45-67", "+77011234567"],
    ["87011234567", "+77011234567"],
    ["77011234567", "+77011234567"],
    ["7011234567", "+77011234567"],
    ["+7-727-250-00-00", "+77272500000"], // Almaty landline
  ])("%s → %s", (raw, expected) => {
    expect(normalizeKzPhone(raw)).toBe(expected);
  });

  it.each([
    "+7 916 123 45 67", // Russian mobile
    "701 123 45 6", // too short
    "+77011234567 доб. 2",
    "+998 90 123 45 67", // Uzbekistan
    "",
    "abc",
  ])("refuses %s", (raw) => {
    expect(normalizeKzPhone(raw)).toBeNull();
  });

  it("formats the canonical form for display", () => {
    expect(formatKzPhone("+77011234567")).toBe("+7 701 123 45 67");
  });
});

describe("who may do what", () => {
  const reflector = new Reflector();
  const roles = (method: keyof LoyaltyController) =>
    reflector.getAllAndOverride<Role[]>(ROLES_KEY, [LoyaltyController.prototype[method], LoyaltyController]);

  it("a cashier finds, registers and records consent, but cannot browse, merge or import", () => {
    for (const m of ["lookup", "register", "findOne", "recordConsent"] as const) expect(roles(m)).toContain(Role.CASHIER);
    for (const m of ["list", "update", "merge", "previewImport", "applyImport"] as const) expect(roles(m)).not.toContain(Role.CASHIER);
  });

  it("merging and importing are owner/admin only", () => {
    for (const m of ["merge", "previewImport", "applyImport"] as const) expect(roles(m)).toEqual([Role.OWNER, Role.ADMIN]);
  });

  it("roles with no till or management job see nothing", () => {
    for (const m of ["lookup", "list", "findOne"] as const) {
      expect(roles(m)).not.toContain(Role.DRIVER);
      expect(roles(m)).not.toContain(Role.PRODUCTION_STAFF);
    }
  });
});

describe("LoyaltyService (database)", () => {
  const prisma = new PrismaService();
  const loyalty = new LoyaltyService(prisma);
  let org: IsolatedOrg;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "loyalty");
  });

  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  const register = (phone: string, extra: object = {}) =>
    loyalty.register(org.user, { phone, personalDataConsent: true, source: S.AT_TILL, ...extra });

  it("registers by phone, stores the canonical number and who recorded the consent", async () => {
    const member = await register("8 701 000 00 01", { name: "Айгерим", marketingChannels: [Ch.WHATSAPP] });
    expect(member.phone).toBe("+77010000001");
    expect(member.status).toBe(LoyaltyMemberStatus.ACTIVE);
    expect(member.consents).toEqual({ personalData: true, marketing: { WHATSAPP: true, TELEGRAM: false, SMS: false } });
    const detail = await loyalty.findOne(org.organizationId, member.id);
    expect(detail.history).toHaveLength(2);
    expect(detail.history.every((h) => h.recordedByName === org.user.fullName && h.source === S.AT_TILL)).toBe(true);
  });

  it("refuses registration without consent to process personal data", async () => {
    await expect(register("+77010000002", { personalDataConsent: false })).rejects.toThrow(/Без согласия/);
    expect(await prisma.loyaltyMember.count({ where: { organizationId: org.organizationId, phone: "+77010000002" } })).toBe(0);
  });

  it("the same number written differently is a duplicate, not a second customer", async () => {
    await expect(register("+7 (701) 000-00-01")).rejects.toThrow(/уже зарегистрирован/);
    await expect(register("+7 916 000 00 01")).rejects.toThrow(/казахстанский номер/);
  });

  it("finds a customer by phone however it is typed; an unknown number is a null, not an error", async () => {
    const found = await loyalty.lookup(org.organizationId, "77010000001");
    expect(found.member?.name).toBe("Айгерим");
    const unknown = await loyalty.lookup(org.organizationId, "87019999999");
    expect(unknown).toEqual({ phone: "+77019999999", member: null });
  });

  it("a withdrawal is a new row; withdrawing personal-data consent closes every channel and the membership", async () => {
    const member = await register("+77010000003", { marketingChannels: [Ch.TELEGRAM, Ch.SMS] });
    await loyalty.recordConsent(org.user, member.id, { purpose: P.MARKETING, channel: Ch.SMS, granted: false, source: S.AT_TILL });
    const after = await loyalty.recordConsent(org.user, member.id, { purpose: P.PERSONAL_DATA, granted: false, source: S.PAPER_FORM, note: "заявление" });
    expect(after.status).toBe(LoyaltyMemberStatus.WITHDRAWN);
    expect(after.consents).toEqual({ personalData: false, marketing: { WHATSAPP: false, TELEGRAM: false, SMS: false } });

    const history = (await loyalty.findOne(org.organizationId, member.id)).history;
    // 3 at registration + SMS off + personal data off + Telegram closed with it
    expect(history).toHaveLength(6);
    expect(history.filter((h) => !h.granted).map((h) => h.channel ?? h.purpose).sort()).toEqual(["PERSONAL_DATA", "SMS", "TELEGRAM"]);

    // Re-joining: a fresh consent reactivates the record; channels stay closed until asked again.
    await expect(
      loyalty.recordConsent(org.user, member.id, { purpose: P.MARKETING, channel: Ch.SMS, granted: true, source: S.AT_TILL }),
    ).rejects.toThrow(/Сначала оформите согласие/);
    const rejoined = await loyalty.recordConsent(org.user, member.id, { purpose: P.PERSONAL_DATA, granted: true, source: S.AT_TILL });
    expect(rejoined.status).toBe(LoyaltyMemberStatus.ACTIVE);
    expect(rejoined.consents.marketing.TELEGRAM).toBe(false);
  });

  it("refuses a no-op, a channel-less marketing consent, and «Импорт» typed by hand", async () => {
    const m = await register("+77010000004");
    await expect(loyalty.recordConsent(org.user, m.id, { purpose: P.PERSONAL_DATA, granted: true, source: S.AT_TILL })).rejects.toThrow(/уже записано/);
    await expect(loyalty.recordConsent(org.user, m.id, { purpose: P.MARKETING, granted: true, source: S.AT_TILL })).rejects.toThrow(/канал/);
    await expect(loyalty.recordConsent(org.user, m.id, { purpose: P.MARKETING, channel: Ch.SMS, granted: true, source: S.IMPORT })).rejects.toThrow(/Импорт/);
  });

  it("the database itself refuses to edit a consent row", async () => {
    const row = await prisma.loyaltyConsent.findFirstOrThrow({ where: { organizationId: org.organizationId } });
    await expect(prisma.loyaltyConsent.update({ where: { id: row.id }, data: { granted: !row.granted } })).rejects.toThrow(/не изменяется/);
  });

  it("merging folds the duplicate into the primary: its phone leads there, consents are not carried over", async () => {
    const primary = await register("+77010000010", {});
    const duplicate = await register("+77010000011", { name: "Ерлан", marketingChannels: [Ch.WHATSAPP] });
    await expect(loyalty.merge(org.user, { primaryId: primary.id, duplicateId: duplicate.id, reason: "нет" })).rejects.toThrow(/причину/);

    const merged = await loyalty.merge(org.user, { primaryId: primary.id, duplicateId: duplicate.id, reason: "Один человек, два номера" });
    expect(merged.name).toBe("Ерлан"); // an empty field is filled from the duplicate
    expect(merged.consents.marketing.WHATSAPP).toBe(false);
    expect(merged.mergedFrom.map((m) => m.phone)).toEqual(["+77010000011"]);

    const viaOldNumber = await loyalty.lookup(org.organizationId, "+77010000011");
    expect(viaOldNumber.member?.id).toBe(primary.id);
    // The duplicate keeps its own history and can no longer be changed.
    expect((await loyalty.findOne(org.organizationId, duplicate.id)).history).toHaveLength(2);
    await expect(loyalty.recordConsent(org.user, duplicate.id, { purpose: P.PERSONAL_DATA, granted: false, source: S.AT_TILL })).rejects.toThrow(/объединена/);
    await expect(loyalty.merge(org.user, { primaryId: primary.id, duplicateId: duplicate.id, reason: "ещё раз" })).rejects.toThrow(/объединена/);
    await expect(register("+77010000011")).rejects.toThrow(/объединён/);

    // A later merge of the primary re-points earlier duplicates straight to the new primary.
    const third = await register("+77010000012");
    await loyalty.merge(org.user, { primaryId: third.id, duplicateId: primary.id, reason: "Основной номер сменился" });
    const dupRow = await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: duplicate.id } });
    expect(dupRow.mergedIntoId).toBe(third.id);
    expect((await loyalty.lookup(org.organizationId, "+77010000011")).member?.id).toBe(third.id);
  });

  it("lists and searches by name or digits, merged records hidden by default", async () => {
    const byDigits = await loyalty.list(org.organizationId, { q: "8 701 000 00 01" });
    expect(byDigits.items.map((m) => m.phone)).toEqual(["+77010000001"]);
    const byName = await loyalty.list(org.organizationId, { q: "айгер" });
    expect(byName.total).toBe(1);
    const all = await loyalty.list(org.organizationId, {});
    expect(all.items.some((m) => m.status === LoyaltyMemberStatus.MERGED)).toBe(false);
    const merged = await loyalty.list(org.organizationId, { status: "MERGED" });
    expect(merged.total).toBe(2);
  });

  it("edits name and note, never the phone", async () => {
    const m = await register("+77010000020", { name: "Старое" });
    const saved = await loyalty.update(org.user, m.id, { name: "  Новое  ", note: "" });
    expect(saved).toMatchObject({ name: "Новое", note: null, phone: "+77010000020" });
  });

  it("import: preview writes nothing, apply only adds people with consent and skips everyone else", async () => {
    const rows = [
      { phone: "8 702 000 00 01", name: "Новый 1", consent: "да", whatsapp: "да" },
      { phone: "+77020000002", name: "Новый 2", consent: "1" },
      { phone: "87020000001", name: "Повтор", consent: "да" },
      { phone: "+77010000001", name: "Уже есть", consent: "да", sms: "да" },
      { phone: "+7 916 000 00 00", consent: "да" },
      { phone: "+77020000003", name: "Без согласия", consent: "нет" },
    ];
    const before = await prisma.loyaltyMember.count({ where: { organizationId: org.organizationId } });
    const preview = await loyalty.previewImport(org.organizationId, rows);
    expect(preview.rows.map((r) => r.status)).toEqual([
      LoyaltyImportRowStatus.NEW,
      LoyaltyImportRowStatus.NEW,
      LoyaltyImportRowStatus.DUPLICATE_IN_FILE,
      LoyaltyImportRowStatus.EXISTS,
      LoyaltyImportRowStatus.INVALID_PHONE,
      LoyaltyImportRowStatus.NO_CONSENT,
    ]);
    expect(await prisma.loyaltyMember.count({ where: { organizationId: org.organizationId } })).toBe(before);

    const result = await loyalty.applyImport(org.user, { rows, note: "Анкеты 2025" });
    expect(result).toEqual({ created: 2, skipped: 4 });
    const imported = (await loyalty.lookup(org.organizationId, "+77020000001")).member!;
    expect(imported.consents.marketing.WHATSAPP).toBe(true);
    const history = (await loyalty.findOne(org.organizationId, imported.id)).history;
    expect(history.every((h) => h.source === S.IMPORT && h.note === "Анкеты 2025")).toBe(true);
    // The existing customer was not touched by the file's «sms: да».
    expect((await loyalty.lookup(org.organizationId, "+77010000001")).member?.consents.marketing.SMS).toBe(false);

    await expect(loyalty.applyImport(org.user, { rows, note: "Анкеты 2025" })).rejects.toThrow(/нет новых/);
  });

  it("every loyalty action leaves an audit entry", async () => {
    const logged = new Set(
      (await prisma.auditLog.findMany({ where: { organizationId: org.organizationId }, select: { action: true } })).map((a) => a.action),
    );
    expect(AUDIT_ACTION_GROUPS.loyalty.filter((a) => !logged.has(a))).toEqual([]);
  });
});
