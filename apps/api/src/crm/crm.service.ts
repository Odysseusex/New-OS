import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  CreateCrmContactRequestDto,
  CrmChannelsDto,
  CrmContactChannel,
  CrmContactDto,
  CrmContactOutcome,
  CrmContactReason,
  CrmMemberListDto,
  CrmMemberProfileDto,
  CrmMemberRowDto,
  CrmOrderStage,
  CrmTimelineItemDto,
  CrmTodayCardDto,
  CrmTodayDto,
  CRM_CONTACT_CHANNEL_LABELS_RU,
  CRM_CONTACT_OUTCOME_LABELS_RU,
  CRM_ORDER_STAGE_LABELS_RU,
  LOYALTY_POINTS_ENTRY_TYPE_LABELS_RU,
  LoyaltyConsentChannel,
  LoyaltyConsentPurpose,
  LoyaltyMemberStatus,
  LoyaltySegment,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { OWN_ITEMS, ownAmount } from "../common/own-sales";
import { startOfZonedDay } from "../common/zoned-day";
import { PrismaService } from "../prisma/prisma.service";
import { nextBirthday } from "../loyalty/birthdays";
import { CustomerBotService } from "../loyalty/customer-bot.service";
import { LoyaltyAnalyticsService } from "../loyalty/loyalty-analytics.service";
import { LoyaltyPointsService } from "../loyalty/loyalty-points.service";
import { consentState, LoyaltyService, memberSearchWhere } from "../loyalty/loyalty.service";
import { toOrderDto, ORDER_INCLUDE } from "./crm-orders.service";
import { contactCooldownDays, DAY, retailVerdict, rhythmPosition, suggestedText, usualProducts, wholesaleVerdict } from "./rhythm";

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" });
const MAX_MERGE_HOPS = 10;
const RETAIL_HISTORY_DAYS = 365;
const WHOLESALE_HISTORY_DAYS = 180;
const RETURN_WINDOW_DAYS = 7;
const COLUMN_LIMIT = 60;
const BIRTHDAY_AHEAD_DAYS = 7;
const LIST_LIMIT = 300;

type Money = { toNumber(): number };
interface SaleLite {
  id: string;
  soldAt: Date;
  net: number;
}

const netOf = (s: { totalAmount: Money; consignmentAmount: Money; returns: { totalAmount: Money; consignmentAmount: Money }[] }) =>
  ownAmount(s) - s.returns.reduce((sum, r) => sum + ownAmount(r), 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
const SAME_FAMILY: Record<CrmContactReason, CrmContactReason[]> = {
  [CrmContactReason.DUE]: [CrmContactReason.DUE, CrmContactReason.LAPSED, CrmContactReason.OTHER, CrmContactReason.ORDER],
  [CrmContactReason.LAPSED]: [CrmContactReason.DUE, CrmContactReason.LAPSED, CrmContactReason.OTHER, CrmContactReason.ORDER],
  [CrmContactReason.BIRTHDAY]: [CrmContactReason.BIRTHDAY, CrmContactReason.ORDER],
  [CrmContactReason.WHOLESALE]: [CrmContactReason.WHOLESALE, CrmContactReason.OTHER, CrmContactReason.ORDER],
  [CrmContactReason.ORDER]: [CrmContactReason.ORDER],
  [CrmContactReason.OTHER]: [CrmContactReason.OTHER],
};

@Injectable()
export class CrmService {
  constructor(
    private prisma: PrismaService,
    private loyalty: LoyaltyService,
    private points: LoyaltyPointsService,
    private analytics: LoyaltyAnalyticsService,
    private customerBot?: CustomerBotService,
  ) {}

  // ── shared reads ────────────────────────────────────────────────────────

  private async organization(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, demoParentId: true } });
    if (!org) throw new NotFoundException("Организация не найдена");
    return { brand: org.name, isDemo: org.demoParentId !== null };
  }

  private async members(organizationId: string) {
    const rows = await this.prisma.loyaltyMember.findMany({
      where: { organizationId },
      select: {
        id: true,
        phone: true,
        name: true,
        status: true,
        mergedIntoId: true,
        createdAt: true,
        consents: { select: { purpose: true, channel: true, granted: true }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] },
      },
    });
    const byId = new Map(rows.map((m) => [m.id, m]));
    // A merged duplicate's sales count for the record it was merged into.
    const finalId = (id: string) => {
      let current = id;
      for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
        const next = byId.get(current)?.mergedIntoId;
        if (!next) break;
        current = next;
      }
      return current;
    };
    return { rows, byId, finalId };
  }

  // Member → their purchases (ours only, net of returns), oldest first.
  private async memberSales(organizationId: string, since: Date, finalId: (id: string) => string) {
    const sales = await this.prisma.sale.findMany({
      where: { organizationId, loyaltyMemberId: { not: null }, soldAt: { gte: since } },
      select: {
        id: true,
        loyaltyMemberId: true,
        soldAt: true,
        totalAmount: true,
        consignmentAmount: true,
        returns: { select: { totalAmount: true, consignmentAmount: true } },
      },
      orderBy: { soldAt: "asc" },
    });
    const byMember = new Map<string, SaleLite[]>();
    for (const s of sales) {
      // A basket made only of consignment goods is not one of our sales.
      if (ownAmount(s) <= 0) continue;
      const id = finalId(s.loyaltyMemberId as string);
      const list = byMember.get(id) ?? [];
      list.push({ id: s.id, soldAt: s.soldAt, net: netOf(s) });
      byMember.set(id, list);
    }
    return byMember;
  }

  private async segments(organizationId: string, now: Date): Promise<{ available: boolean; of: Map<string, LoyaltySegment> }> {
    const result = await this.analytics.analytics(organizationId, new Date(now.getTime() - 30 * DAY), now, {});
    return { available: result.segments.available, of: new Map(result.segments.rows.map((r) => [r.memberId, r.segment as LoyaltySegment])) };
  }

  private async telegramReachable(memberIds: string[]): Promise<Set<string>> {
    return this.customerBot?.isEnabled() ? this.customerBot.reachableIds(memberIds) : new Set();
  }

  private channels(isDemo: boolean, consents: { purpose: string; channel: string | null; granted: boolean }[], telegram: boolean): CrmChannelsDto {
    // A sandbox customer's number is invented and may be somebody real's.
    if (isDemo) return { whatsapp: false, telegram: false, call: false };
    const state = consentState(consents as never);
    return { whatsapp: state.marketing.WHATSAPP, telegram, call: true };
  }

  private async usualFor(saleIdsByKey: Map<string, string[]>, withQuantity: boolean): Promise<Map<string, string[]>> {
    const saleIds = [...saleIdsByKey.values()].flat();
    if (saleIds.length === 0) return new Map();
    const items = await this.prisma.saleItem.findMany({
      where: { saleId: { in: saleIds }, ...OWN_ITEMS },
      select: { saleId: true, quantity: true, product: { select: { name: true } } },
    });
    const keyOfSale = new Map<string, string>();
    for (const [key, ids] of saleIdsByKey) for (const id of ids) keyOfSale.set(id, key);
    const byKey = new Map<string, { saleId: string; name: string; quantity: number }[]>();
    for (const it of items) {
      const key = keyOfSale.get(it.saleId)!;
      const list = byKey.get(key) ?? [];
      list.push({ saleId: it.saleId, name: it.product.name, quantity: it.quantity.toNumber() });
      byKey.set(key, list);
    }
    return new Map([...byKey].map(([key, list]) => [key, usualProducts(list, 3, withQuantity)]));
  }

  // ── «Сегодня» ───────────────────────────────────────────────────────────

  async today(organizationId: string, now = new Date()): Promise<CrmTodayDto> {
    const today = startOfZonedDay(now).getTime();
    const [org, universe, segments] = await Promise.all([
      this.organization(organizationId),
      this.members(organizationId),
      this.segments(organizationId, now),
    ]);
    const { byId, finalId } = universe;
    const [sales, contacts, family, customers, customerSales, orders] = await Promise.all([
      this.memberSales(organizationId, new Date(today - RETAIL_HISTORY_DAYS * DAY), finalId),
      this.prisma.crmContact.findMany({ where: { organizationId, at: { gte: new Date(today - 60 * DAY) } }, orderBy: { at: "desc" } }),
      this.prisma.loyaltyFamilyMember.findMany({ where: { organizationId, archivedAt: null } }),
      this.prisma.customer.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true, phone: true } }),
      this.prisma.sale.findMany({
        where: { organizationId, customerId: { not: null }, soldAt: { gte: new Date(today - WHOLESALE_HISTORY_DAYS * DAY) } },
        select: { id: true, customerId: true, soldAt: true, totalAmount: true, consignmentAmount: true, returns: { select: { totalAmount: true, consignmentAmount: true } } },
        orderBy: { soldAt: "asc" },
      }),
      this.prisma.crmOrder.findMany({
        where: { organizationId, stage: { notIn: [CrmOrderStage.DONE, CrmOrderStage.CANCELLED] }, dueAt: { lt: new Date(today + 2 * DAY) } },
        orderBy: { dueAt: "asc" },
        take: 10,
      }),
    ]);

    const contactable = (id: string) => {
      const m = byId.get(id);
      if (!m || m.status !== LoyaltyMemberStatus.ACTIVE) return false;
      const state = consentState(m.consents as never);
      return state.marketing.WHATSAPP || state.marketing.TELEGRAM || state.marketing.SMS;
    };
    const contactsOf = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const key = c.memberId ? `m:${finalId(c.memberId)}` : c.customerId ? `c:${c.customerId}` : null;
      if (!key) continue;
      contactsOf.set(key, [...(contactsOf.get(key) ?? []), c]);
    }
    // Today → the card is done; within the cooldown → hidden; else → shown.
    const contactStatus = (key: string, reason: CrmContactReason, cooldownDays: number) => {
      const relevant = (contactsOf.get(key) ?? []).filter((c) => SAME_FAMILY[reason].includes(c.reason as CrmContactReason));
      const latest = relevant[0];
      if (!latest) return { state: "open" as const };
      if (latest.at.getTime() >= today) return { state: "done" as const, contact: latest };
      if (latest.at.getTime() >= today - cooldownDays * DAY) return { state: "hidden" as const };
      return { state: "open" as const };
    };

    type Draft = Omit<CrmTodayCardDto, "usual" | "pointsBalance" | "suggestedText" | "channels"> & { saleIds: string[]; consentsOf?: string };
    const drafts: Draft[] = [];
    const doneContact = new Map<string, (typeof contacts)[number]>();

    for (const [memberId, list] of sales) {
      if (!contactable(memberId)) continue;
      const p = rhythmPosition(list.map((s) => startOfZonedDay(s.soldAt).getTime()), today);
      const verdict = retailVerdict(p);
      if (!verdict) continue;
      const reason = verdict === "DUE" ? CrmContactReason.DUE : CrmContactReason.LAPSED;
      const status = contactStatus(`m:${memberId}`, reason, contactCooldownDays(p.rhythmDays));
      if (status.state === "hidden") continue;
      const m = byId.get(memberId)!;
      const key = `member:${memberId}`;
      if (status.state === "done") doneContact.set(key, status.contact);
      drafts.push({
        key,
        reason,
        memberId,
        customerId: null,
        name: m.name,
        phone: m.phone,
        rhythmDays: p.rhythmDays,
        daysSinceLastVisit: p.daysSince,
        overdueDays: p.overdueDays,
        lastVisitAt: list[list.length - 1].soldAt.toISOString(),
        visits: p.visitDays,
        segment: segments.of.get(memberId) ?? null,
        birthday: null,
        contactedAt: null,
        contactOutcome: null,
        contactedByName: null,
        saleIds: list.slice(-40).map((s) => s.id),
        consentsOf: memberId,
      });
    }

    for (const f of family) {
      const memberId = finalId(f.memberId);
      if (!contactable(memberId)) continue;
      const next = nextBirthday(now, f.birthMonth, f.birthDay);
      const inDays = Math.round((next.at.getTime() - today) / DAY);
      if (inDays < 0 || inDays > BIRTHDAY_AHEAD_DAYS) continue;
      const status = contactStatus(`m:${memberId}`, CrmContactReason.BIRTHDAY, 14);
      if (status.state === "hidden") continue;
      const m = byId.get(memberId)!;
      const list = sales.get(memberId) ?? [];
      const key = `birthday:${f.id}`;
      if (status.state === "done") doneContact.set(key, status.contact);
      drafts.push({
        key,
        reason: CrmContactReason.BIRTHDAY,
        memberId,
        customerId: null,
        name: m.name,
        phone: m.phone,
        rhythmDays: null,
        daysSinceLastVisit: list.length ? Math.round((today - startOfZonedDay(list[list.length - 1].soldAt).getTime()) / DAY) : null,
        overdueDays: null,
        lastVisitAt: list.length ? list[list.length - 1].soldAt.toISOString() : null,
        visits: new Set(list.map((s) => dayKey.format(s.soldAt))).size,
        segment: segments.of.get(memberId) ?? null,
        birthday: {
          familyId: f.id,
          name: f.name,
          relation: f.relation,
          date: dayKey.format(next.at),
          inDays,
          turns: f.birthYear ? next.year - f.birthYear : null,
        },
        contactedAt: null,
        contactOutcome: null,
        contactedByName: null,
        saleIds: list.slice(-40).map((s) => s.id),
        consentsOf: memberId,
      });
    }

    const salesOfCustomer = new Map<string, SaleLite[]>();
    for (const s of customerSales) {
      if (ownAmount(s) <= 0) continue;
      const list = salesOfCustomer.get(s.customerId as string) ?? [];
      list.push({ id: s.id, soldAt: s.soldAt, net: netOf(s) });
      salesOfCustomer.set(s.customerId as string, list);
    }
    for (const c of customers) {
      const list = salesOfCustomer.get(c.id);
      if (!list) continue;
      const p = rhythmPosition(list.map((s) => startOfZonedDay(s.soldAt).getTime()), today);
      if (!wholesaleVerdict(p)) continue;
      const status = contactStatus(`c:${c.id}`, CrmContactReason.WHOLESALE, contactCooldownDays(p.rhythmDays));
      if (status.state === "hidden") continue;
      const key = `customer:${c.id}`;
      if (status.state === "done") doneContact.set(key, status.contact);
      drafts.push({
        key,
        reason: CrmContactReason.WHOLESALE,
        memberId: null,
        customerId: c.id,
        name: c.name,
        phone: c.phone,
        rhythmDays: p.rhythmDays,
        daysSinceLastVisit: p.daysSince,
        overdueDays: p.overdueDays,
        lastVisitAt: list[list.length - 1].soldAt.toISOString(),
        visits: p.visitDays,
        segment: null,
        birthday: null,
        contactedAt: null,
        contactOutcome: null,
        contactedByName: null,
        saleIds: list.slice(-20).map((s) => s.id),
      });
    }

    const memberIds = [...new Set(drafts.map((d) => d.memberId).filter((id): id is string => !!id))];
    const [retailUsual, wholesaleUsual, balances, telegram] = await Promise.all([
      // Keyed by person, not card: a birthday card and a «пора» card share the same purchases.
      this.usualFor(new Map(drafts.filter((d) => d.memberId).map((d) => [d.memberId as string, d.saleIds])), false),
      this.usualFor(new Map(drafts.filter((d) => d.customerId).map((d) => [d.customerId as string, d.saleIds])), true),
      this.points.balances(organizationId, memberIds),
      this.telegramReachable(memberIds),
    ]);

    const cards = drafts.map(({ saleIds: _saleIds, consentsOf, ...d }): CrmTodayCardDto => {
      const usual = (d.customerId ? wholesaleUsual.get(d.customerId) : retailUsual.get(d.memberId as string)) ?? [];
      const pointsBalance = d.memberId ? balances.get(d.memberId) ?? 0 : 0;
      const holderName = d.name?.trim().split(/\s+/)[0]?.toLowerCase();
      const contact = doneContact.get(d.key);
      return {
        ...d,
        usual,
        pointsBalance,
        channels: consentsOf
          ? this.channels(org.isDemo, byId.get(consentsOf)!.consents, telegram.has(consentsOf))
          : { whatsapp: !org.isDemo && !!d.phone, telegram: false, call: !org.isDemo && !!d.phone },
        contactedAt: contact?.at.toISOString() ?? null,
        contactOutcome: (contact?.outcome as CrmContactOutcome) ?? null,
        contactedByName: contact?.byName ?? null,
        suggestedText: suggestedText(d.reason as "DUE" | "LAPSED" | "BIRTHDAY" | "WHOLESALE", {
          brand: org.brand,
          name: d.customerId ? null : d.name,
          usual,
          points: pointsBalance,
          birthdayOf: d.birthday
            ? { name: d.birthday.name, relation: d.birthday.relation, isHolder: !!holderName && d.birthday.name.trim().toLowerCase().startsWith(holderName) && !d.birthday.relation }
            : undefined,
        }),
      };
    });

    const open = cards.filter((c) => !c.contactedAt);
    const pick = (reason: CrmContactReason, sort: (a: CrmTodayCardDto, b: CrmTodayCardDto) => number) =>
      open.filter((c) => c.reason === reason).sort(sort).slice(0, COLUMN_LIMIT);

    // «Вернулись после сообщения»: a contact in the last 30 days followed by a purchase within a week.
    const since30 = today - 30 * DAY;
    const recent = contacts.filter((c) => c.at.getTime() >= since30);
    const counted = new Set<string>();
    let returned = 0;
    let revenue = 0;
    for (const c of recent) {
      const list = c.memberId ? sales.get(finalId(c.memberId)) : c.customerId ? salesOfCustomer.get(c.customerId) : undefined;
      const after = (list ?? []).filter((s) => s.soldAt > c.at && s.soldAt.getTime() <= c.at.getTime() + RETURN_WINDOW_DAYS * DAY);
      if (after.length === 0) continue;
      returned += 1;
      for (const s of after) {
        if (counted.has(s.id)) continue;
        counted.add(s.id);
        revenue += s.net;
      }
    }

    const due = pick(CrmContactReason.DUE, (a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || b.visits - a.visits);
    const lapsed = pick(CrmContactReason.LAPSED, (a, b) => b.visits - a.visits);
    const wholesale = pick(CrmContactReason.WHOLESALE, (a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));
    const birthdays = pick(CrmContactReason.BIRTHDAY, (a, b) => (a.birthday?.inDays ?? 0) - (b.birthday?.inDays ?? 0));
    const done = cards.filter((c) => c.contactedAt).sort((a, b) => (b.contactedAt ?? "").localeCompare(a.contactedAt ?? ""));

    return {
      date: dayKey.format(now),
      due,
      lapsed,
      wholesale,
      birthdays,
      done,
      agenda: orders.map((o) => ({ orderId: o.id, number: o.number, title: o.title, customerName: o.customerName, dueAt: o.dueAt.toISOString(), stage: o.stage as CrmOrderStage })),
      stats: {
        toContact: due.length + lapsed.length + wholesale.length + birthdays.length,
        contactedToday: done.length,
        contacts30: recent.length,
        returned30: returned,
        returnedRevenue30: round2(revenue),
      },
    };
  }

  // ── contacts ────────────────────────────────────────────────────────────

  async recordContact(user: AuthenticatedUser, dto: CreateCrmContactRequestDto): Promise<CrmContactDto> {
    if (!dto.memberId && !dto.customerId) throw new BadRequestException("Не указан клиент");
    if (dto.memberId) {
      const m = await this.prisma.loyaltyMember.findFirst({ where: { id: dto.memberId, organizationId: user.organizationId }, select: { id: true } });
      if (!m) throw new NotFoundException("Клиент не найден");
    }
    if (dto.customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: dto.customerId, organizationId: user.organizationId }, select: { id: true } });
      if (!c) throw new NotFoundException("Клиент не найден");
    }
    if (dto.orderId) {
      const o = await this.prisma.crmOrder.findFirst({ where: { id: dto.orderId, organizationId: user.organizationId }, select: { id: true } });
      if (!o) throw new NotFoundException("Заказ не найден");
    }
    const row = await this.prisma.crmContact.create({
      data: {
        organizationId: user.organizationId,
        memberId: dto.memberId ?? null,
        customerId: dto.customerId ?? null,
        orderId: dto.orderId ?? null,
        channel: dto.channel,
        outcome: dto.outcome,
        reason: dto.reason,
        note: dto.note?.trim() || null,
        byId: user.id,
        byName: user.fullName,
      },
    });
    return toContactDto(row);
  }

  // ── customers list ──────────────────────────────────────────────────────

  async list(organizationId: string, query: { q?: string; segment?: string; sort?: string }, now = new Date()): Promise<CrmMemberListDto> {
    const today = startOfZonedDay(now).getTime();
    const where = memberSearchWhere(organizationId, { q: query.q });
    const [universe, segments, members, total] = await Promise.all([
      this.members(organizationId),
      this.segments(organizationId, now),
      this.prisma.loyaltyMember.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, take: 5000 }),
      this.prisma.loyaltyMember.count({ where }),
    ]);
    const sales = await this.memberSales(organizationId, new Date(today - RETAIL_HISTORY_DAYS * DAY), universe.finalId);
    const segment = Object.values(LoyaltySegment).includes(query.segment as LoyaltySegment) ? (query.segment as LoyaltySegment) : null;

    let rows: CrmMemberRowDto[] = members.map(({ id }) => {
      const m = universe.byId.get(id)!;
      const list = sales.get(id) ?? [];
      const p = rhythmPosition(list.map((s) => startOfZonedDay(s.soldAt).getTime()), today);
      return {
        id,
        name: m.name,
        phone: m.phone,
        visits: p.visitDays,
        spend: round2(list.reduce((s, v) => s + v.net, 0)),
        lastVisitAt: list.length ? list[list.length - 1].soldAt.toISOString() : null,
        daysSinceLastVisit: p.daysSince,
        rhythmDays: p.rhythmDays,
        overdueDays: p.overdueDays,
        segment: segments.of.get(id) ?? null,
        pointsBalance: 0,
        whatsapp: consentState(m.consents as never).marketing.WHATSAPP,
        createdAt: m.createdAt.toISOString(),
      };
    });
    if (segment) rows = rows.filter((r) => r.segment === segment);
    const sorters: Record<string, (a: CrmMemberRowDto, b: CrmMemberRowDto) => number> = {
      spend: (a, b) => b.spend - a.spend,
      visits: (a, b) => b.visits - a.visits,
      recent: (a, b) => (b.lastVisitAt ?? "").localeCompare(a.lastVisitAt ?? ""),
      new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    rows.sort(sorters[query.sort ?? "recent"] ?? sorters.recent);
    const filteredTotal = segment ? rows.length : total;
    rows = rows.slice(0, LIST_LIMIT);
    const balances = await this.points.balances(organizationId, rows.map((r) => r.id));
    for (const r of rows) r.pointsBalance = balances.get(r.id) ?? 0;
    return { items: rows, total: filteredTotal, segmentsAvailable: segments.available };
  }

  // ── a customer's card ───────────────────────────────────────────────────

  async profile(organizationId: string, memberId: string, now = new Date()): Promise<CrmMemberProfileDto> {
    const member = await this.loyalty.findOne(organizationId, memberId);
    const today = startOfZonedDay(now).getTime();
    const ids = [member.id, ...member.mergedFrom.map((m) => m.id)];
    const [org, segments, sales, messages, contacts, orders, telegram] = await Promise.all([
      this.organization(organizationId),
      this.segments(organizationId, now),
      this.prisma.sale.findMany({
        where: { organizationId, loyaltyMemberId: { in: ids } },
        select: {
          id: true,
          soldAt: true,
          totalAmount: true,
          consignmentAmount: true,
          items: { where: OWN_ITEMS, select: { quantity: true, product: { select: { name: true } } } },
          returns: { select: { id: true, returnedAt: true, totalAmount: true, consignmentAmount: true } },
        },
        orderBy: { soldAt: "desc" },
        take: 500,
      }),
      this.prisma.loyaltyMessageLog.findMany({ where: { memberId: { in: ids } }, orderBy: { sentAt: "desc" }, take: 40 }),
      this.prisma.crmContact.findMany({ where: { organizationId, memberId: { in: ids } }, orderBy: { at: "desc" }, take: 60 }),
      this.prisma.crmOrder.findMany({ where: { organizationId, memberId: { in: ids } }, include: ORDER_INCLUDE, orderBy: { dueAt: "desc" }, take: 30 }),
      this.telegramReachable([member.id]),
    ]);

    const own = sales.filter((s) => ownAmount(s) > 0);
    const yearAgo = today - RETAIL_HISTORY_DAYS * DAY;
    const recent = own.filter((s) => s.soldAt.getTime() >= yearAgo);
    const p = rhythmPosition(recent.map((s) => startOfZonedDay(s.soldAt).getTime()), today);
    const days = [...new Set(recent.map((s) => startOfZonedDay(s.soldAt).getTime()))].sort((a, b) => a - b).slice(-25);
    const intervals = days.slice(1).map((d, i) => Math.round((d - days[i]) / DAY));
    const spend = round2(own.reduce((s, v) => s + netOf({ ...v, returns: v.returns }), 0));

    const favCount = new Map<string, number>();
    for (const s of recent) for (const name of new Set(s.items.map((i) => i.product.name))) favCount.set(name, (favCount.get(name) ?? 0) + 1);
    const favorites = [...favCount]
      .sort(([an, a], [bn, b]) => b - a || an.localeCompare(bn, "ru"))
      .slice(0, 6)
      .map(([name, visits]) => ({ name, visits, share: recent.length ? visits / recent.length : 0 }));

    const qty = (q: number) => (Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000).replace(".", ","));
    const timeline: CrmTimelineItemDto[] = [];
    for (const s of sales.slice(0, 40)) {
      const items = s.items.map((i) => (i.quantity.toNumber() === 1 ? i.product.name : `${i.product.name} ×${qty(i.quantity.toNumber())}`));
      timeline.push({ id: `sale:${s.id}`, kind: "SALE", at: s.soldAt.toISOString(), title: "Покупка", detail: items.join(", ") || null, byName: null, amount: round2(ownAmount(s)) });
      for (const r of s.returns) {
        timeline.push({ id: `return:${r.id}`, kind: "RETURN", at: r.returnedAt.toISOString(), title: "Возврат", detail: null, byName: null, amount: round2(ownAmount(r)) });
      }
    }
    for (const e of member.pointsHistory.slice(0, 40)) {
      timeline.push({
        id: `points:${e.id}`,
        kind: "POINTS",
        at: e.createdAt,
        title: `${e.points > 0 ? "+" : "−"}${Math.abs(e.points)} ${pointsWord(Math.abs(e.points))}`,
        detail: LOYALTY_POINTS_ENTRY_TYPE_LABELS_RU[e.type] + (e.reason ? ` · ${e.reason}` : ""),
        byName: e.createdByName,
        amount: null,
      });
    }
    for (const m of messages) {
      timeline.push({
        id: `msg:${m.id}`,
        kind: "MESSAGE",
        at: m.sentAt.toISOString(),
        title: `Сообщение в ${m.channel === LoyaltyConsentChannel.WHATSAPP ? "WhatsApp" : "Telegram"}`,
        detail: m.text,
        byName: null,
        amount: null,
      });
    }
    for (const c of contacts) {
      timeline.push({
        id: `contact:${c.id}`,
        kind: "CONTACT",
        at: c.at.toISOString(),
        title: `${CRM_CONTACT_CHANNEL_LABELS_RU[c.channel as CrmContactChannel]} · ${CRM_CONTACT_OUTCOME_LABELS_RU[c.outcome as CrmContactOutcome]}`,
        detail: c.note,
        byName: c.byName,
        amount: null,
      });
    }
    for (const h of member.history) {
      const what = h.purpose === LoyaltyConsentPurpose.PERSONAL_DATA ? "обработку персональных данных" : `сообщения в ${h.channel === LoyaltyConsentChannel.WHATSAPP ? "WhatsApp" : h.channel === LoyaltyConsentChannel.TELEGRAM ? "Telegram" : "SMS"}`;
      timeline.push({ id: `consent:${h.id}`, kind: "CONSENT", at: h.recordedAt, title: `${h.granted ? "Согласие на" : "Отказ от"} ${what}`, detail: h.note, byName: h.recordedByName, amount: null });
    }
    for (const o of orders) {
      for (const e of o.events) {
        timeline.push({
          id: `order:${e.id}`,
          kind: "ORDER",
          at: e.at.toISOString(),
          title: e.fromStage ? `Заказ №${o.number}: ${CRM_ORDER_STAGE_LABELS_RU[e.toStage as CrmOrderStage]}` : `Заказ №${o.number} создан`,
          detail: o.title,
          byName: e.byName,
          amount: null,
        });
      }
    }
    timeline.push({ id: `registered:${member.id}`, kind: "REGISTERED", at: member.createdAt, title: "Зарегистрирован в бонусной программе", detail: null, byName: null, amount: null });
    timeline.sort((a, b) => b.at.localeCompare(a.at));

    return {
      member,
      stats: {
        visits: new Set(own.map((s) => dayKey.format(s.soldAt))).size,
        spend,
        averageCheck: own.length ? round2(spend / own.length) : null,
        firstVisitAt: own.length ? own[own.length - 1].soldAt.toISOString() : null,
        lastVisitAt: own.length ? own[0].soldAt.toISOString() : null,
        daysSinceLastVisit: own.length ? Math.round((today - startOfZonedDay(own[0].soldAt).getTime()) / DAY) : null,
      },
      rhythm: {
        days: p.rhythmDays,
        expectedAt: p.rhythmDays !== null && p.lastDay !== null ? new Date(p.lastDay + p.rhythmDays * DAY).toISOString() : null,
        overdueDays: p.overdueDays,
        intervals,
      },
      favorites,
      segment: segments.of.get(member.id) ?? null,
      timeline: timeline.slice(0, 100),
      orders: orders.map(toOrderDto),
      channels: this.channels(org.isDemo, member.history.slice().reverse().map((h) => ({ purpose: h.purpose, channel: h.channel, granted: h.granted })), telegram.has(member.id)),
    };
  }
}

export function toContactDto(row: {
  id: string;
  memberId: string | null;
  customerId: string | null;
  channel: string;
  outcome: string;
  reason: string;
  note: string | null;
  byName: string | null;
  at: Date;
}): CrmContactDto {
  return {
    id: row.id,
    memberId: row.memberId,
    customerId: row.customerId,
    channel: row.channel as CrmContactChannel,
    outcome: row.outcome as CrmContactOutcome,
    reason: row.reason as CrmContactReason,
    note: row.note,
    byName: row.byName,
    at: row.at.toISOString(),
  };
}

function pointsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "балл";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "балла";
  return "баллов";
}
