import { BadRequestException, forwardRef, HttpException, Inject, HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ClubChatDirection, ClubChatKind } from "@prisma/client";
import {
  CLUB_CHAT_MAX_LENGTH,
  ClubChatDto,
  ClubChatMessageDto,
  CrmChatAudienceDto,
  CrmChatBroadcastDto,
  CrmChatListDto,
  CrmChatOverviewDto,
  CrmChatThreadDto,
  DEFAULT_LOYALTY_CHURN_SETTINGS,
  LOYALTY_SEGMENT_LABELS_RU,
  LOYALTY_SEGMENTS,
  LOYALTY_TIER_LABELS_RU,
  LoyaltyMemberStatus,
  LoyaltySegment,
  LoyaltyTier,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { ClubPushService } from "./club-push.service";
import { LoyaltyAnalyticsService } from "./loyalty-analytics.service";
import { LoyaltyPointsService } from "./loyalty-points.service";

// The chat of the customer app: one thread per member, read by the customer in
// the app and by the staff in CRM. Automatic notices (bonuses, gifts, a new
// level) are written into the same thread, so the customer finds everything
// the bakery ever told them in one place.

const THREAD_LIMIT = 300;
const LIST_LIMIT = 300;
const DAY = 86_400_000;
// A customer's own messages: enough for a conversation, not for a flood.
const CUSTOMER_LIMIT = { messages: 30, minutes: 10 };
const CHAT_URL = "/app?tab=chat";

type Row = {
  id: string;
  createdAt: Date;
  direction: ClubChatDirection;
  kind: ClubChatKind;
  title: string | null;
  text: string;
  sentByName: string | null;
  readAt: Date | null;
};

function clean(raw: string): string {
  const text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new BadRequestException("Напишите сообщение");
  if (text.length > CLUB_CHAT_MAX_LENGTH) throw new BadRequestException(`Сообщение не длиннее ${CLUB_CHAT_MAX_LENGTH} знаков`);
  return text;
}

@Injectable()
export class ClubChatService {
  private readonly logger = new Logger(ClubChatService.name);

  constructor(
    private prisma: PrismaService,
    private push: ClubPushService,
    @Inject(forwardRef(() => LoyaltyAnalyticsService)) private analytics: LoyaltyAnalyticsService,
    private points: LoyaltyPointsService,
  ) {}

  // Signed in to the app on some phone: the only customers a message can reach.
  async isAppMember(memberId: string): Promise<boolean> {
    return (await this.prisma.clubLoginRequest.count({ where: { memberId, status: "USED" } })) > 0;
  }

  private async appMemberIds(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.clubLoginRequest.findMany({
      where: { organizationId, status: "USED", memberId: { not: null }, member: { status: LoyaltyMemberStatus.ACTIVE } },
      select: { memberId: true },
      distinct: ["memberId"],
    });
    return rows.map((r) => r.memberId!);
  }

  // Every member with the app, across organizations — for the daily reminders.
  async allAppMemberIds(): Promise<string[]> {
    const rows = await this.prisma.clubLoginRequest.findMany({ where: { status: "USED", memberId: { not: null } }, select: { memberId: true }, distinct: ["memberId"] });
    return rows.map((r) => r.memberId!);
  }

  // An automatic notice, written once per key. Never throws.
  async notice(memberId: string, key: string, message: { title: string | null; body: string }, by?: { id: string; fullName: string }): Promise<void> {
    try {
      const member = await this.prisma.loyaltyMember.findUnique({ where: { id: memberId }, select: { organizationId: true, status: true } });
      if (!member || member.status !== LoyaltyMemberStatus.ACTIVE) return;
      await this.prisma.clubChatMessage.create({
        data: {
          organizationId: member.organizationId,
          memberId,
          direction: ClubChatDirection.OUT,
          kind: by ? ClubChatKind.TEXT : ClubChatKind.NOTICE,
          title: message.title,
          text: message.body,
          noticeKey: key,
          sentById: by?.id ?? null,
          sentByName: by?.fullName ?? null,
        },
      });
    } catch {
      // the key is already written (a repeat), or the member is gone: nothing to add
    }
  }

  // ── the customer's side (the app) ─────────────────────────────────────────

  async unreadForMember(memberId: string): Promise<number> {
    return this.prisma.clubChatMessage.count({ where: { memberId, direction: ClubChatDirection.OUT, readAt: null } });
  }

  // Opening the chat is reading it.
  async threadForMember(memberId: string): Promise<ClubChatDto> {
    const rows = await this.rows(memberId);
    await this.prisma.clubChatMessage.updateMany({ where: { memberId, direction: ClubChatDirection.OUT, readAt: null }, data: { readAt: new Date() } });
    return { messages: rows.map((r) => this.toDto(r, false)) };
  }

  async sendFromMember(organizationId: string, memberId: string, raw: string): Promise<ClubChatMessageDto> {
    const text = clean(raw);
    const recent = await this.prisma.clubChatMessage.count({
      where: { memberId, direction: ClubChatDirection.IN, createdAt: { gte: new Date(Date.now() - CUSTOMER_LIMIT.minutes * 60_000) } },
    });
    if (recent >= CUSTOMER_LIMIT.messages) {
      throw new HttpException("Слишком много сообщений подряд. Подождите несколько минут.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const row = await this.prisma.clubChatMessage.create({ data: { organizationId, memberId, direction: ClubChatDirection.IN, kind: ClubChatKind.TEXT, text } });
    return this.toDto(row, false);
  }

  // ── the staff's side (CRM) ────────────────────────────────────────────────

  async unreadForStaff(organizationId: string): Promise<number> {
    return this.prisma.clubChatMessage.count({ where: { organizationId, direction: ClubChatDirection.IN, readAt: null } });
  }

  async list(organizationId: string): Promise<CrmChatListDto> {
    const [latest, unread] = await Promise.all([
      this.prisma.clubChatMessage.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        distinct: ["memberId"],
        take: LIST_LIMIT,
        select: { memberId: true, text: true, title: true, createdAt: true, direction: true, member: { select: { name: true, phone: true } } },
      }),
      this.prisma.clubChatMessage.groupBy({ by: ["memberId"], where: { organizationId, direction: ClubChatDirection.IN, readAt: null }, _count: { _all: true } }),
    ]);
    const unreadBy = new Map(unread.map((u) => [u.memberId, u._count._all]));
    const items = latest
      .map((m) => ({
        memberId: m.memberId,
        name: m.member.name,
        phone: m.member.phone,
        lastText: m.title ? `${m.title} · ${m.text}` : m.text,
        lastAt: m.createdAt.toISOString(),
        lastFrom: m.direction === ClubChatDirection.IN ? ("CUSTOMER" as const) : ("BAKERY" as const),
        unread: unreadBy.get(m.memberId) ?? 0,
      }))
      // Waiting for an answer first, then the freshest.
      .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.lastAt.localeCompare(a.lastAt));
    return { items, unread: unread.reduce((s, u) => s + u._count._all, 0) };
  }

  // Opening a thread in CRM is reading the customer's messages.
  async thread(organizationId: string, memberId: string): Promise<CrmChatThreadDto> {
    const member = await this.prisma.loyaltyMember.findFirst({ where: { id: memberId, organizationId }, select: { id: true, name: true, phone: true } });
    if (!member) throw new NotFoundException("Клиент не найден");
    const [rows, inApp, notifications] = await Promise.all([this.rows(memberId), this.isAppMember(memberId), this.push.hasDevices(memberId)]);
    await this.prisma.clubChatMessage.updateMany({ where: { memberId, direction: ClubChatDirection.IN, readAt: null }, data: { readAt: new Date() } });
    return { member: { ...member, inApp, notifications }, messages: rows.map((r) => this.toDto(r, true)) };
  }

  async reply(user: AuthenticatedUser, memberId: string, raw: string): Promise<ClubChatMessageDto> {
    const text = clean(raw);
    const member = await this.prisma.loyaltyMember.findFirst({ where: { id: memberId, organizationId: user.organizationId }, select: { status: true } });
    if (!member) throw new NotFoundException("Клиент не найден");
    if (member.status !== LoyaltyMemberStatus.ACTIVE) throw new BadRequestException("Клиент не участвует в программе — написать ему нельзя");
    if (!(await this.isAppMember(memberId))) throw new BadRequestException("Клиент ещё не вошёл в приложение — сообщение некому прочитать");
    const row = await this.prisma.clubChatMessage.create({
      data: { organizationId: user.organizationId, memberId, direction: ClubChatDirection.OUT, kind: ClubChatKind.TEXT, text, sentById: user.id, sentByName: user.fullName },
    });
    // Never awaited: the phone's push service must not slow the answer down.
    void this.push.send(memberId, `chat:${row.id}`, { title: "Новое сообщение", body: text, url: CHAT_URL });
    return this.toDto(row, true);
  }

  // ── mass messages ─────────────────────────────────────────────────────────

  async overview(organizationId: string): Promise<CrmChatOverviewDto> {
    const [groups, broadcasts] = await Promise.all([this.audienceMembers(organizationId), this.prisma.clubChatBroadcast.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 })]);
    const audiences: CrmChatAudienceDto[] = groups.map((g) => ({ key: g.key, label: g.label, members: g.memberIds.length }));
    return {
      appMembers: groups[0]?.memberIds.length ?? 0,
      audiences,
      broadcasts: broadcasts.map((b): CrmChatBroadcastDto => ({ id: b.id, audience: b.audience, text: b.text, recipients: b.recipients, byName: b.sentByName, at: b.createdAt.toISOString() })),
    };
  }

  async broadcast(user: AuthenticatedUser, audienceKey: string, raw: string): Promise<CrmChatBroadcastDto> {
    const text = clean(raw);
    const group = (await this.audienceMembers(user.organizationId)).find((g) => g.key === audienceKey);
    if (!group) throw new BadRequestException("Выберите, кому отправить");
    if (group.memberIds.length === 0) throw new BadRequestException("В этой группе пока нет клиентов с приложением");
    const saved = await this.prisma.$transaction(async (tx) => {
      const b = await tx.clubChatBroadcast.create({
        data: { organizationId: user.organizationId, audience: group.label, text, recipients: group.memberIds.length, sentById: user.id, sentByName: user.fullName },
      });
      await tx.clubChatMessage.createMany({
        data: group.memberIds.map((memberId) => ({
          organizationId: user.organizationId,
          memberId,
          direction: ClubChatDirection.OUT,
          kind: ClubChatKind.BROADCAST,
          text,
          broadcastId: b.id,
          sentById: user.id,
          sentByName: user.fullName,
        })),
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "clubChat.broadcast",
        entityType: "ClubChatBroadcast",
        entityId: b.id,
        after: { audience: group.label, recipients: group.memberIds.length, text },
      });
      return b;
    });
    // The phones are told after the answer, one by one (a few thousand at most).
    void this.pushAll(group.memberIds, `broadcast:${saved.id}`, text);
    return { id: saved.id, audience: saved.audience, text: saved.text, recipients: saved.recipients, byName: saved.sentByName, at: saved.createdAt.toISOString() };
  }

  private async pushAll(memberIds: string[], key: string, text: string): Promise<void> {
    for (const memberId of memberIds) {
      await this.push.send(memberId, key, { title: "Новое сообщение", body: text, url: CHAT_URL });
    }
    this.logger.log(`Mass message ${key} offered to ${memberIds.length} members' phones`);
  }

  // «Все», then the levels (when they are on), then the purchase groups — each
  // narrowed to customers signed in to the app.
  private async audienceMembers(organizationId: string): Promise<{ key: string; label: string; memberIds: string[] }[]> {
    const app = await this.appMemberIds(organizationId);
    const groups: { key: string; label: string; memberIds: string[] }[] = [{ key: "ALL", label: "Все клиенты с приложением", memberIds: app }];
    if (app.length === 0) return groups;
    const inApp = new Set(app);

    const settings = await this.points.getSettings(organizationId);
    if (settings.tiersEnabled) {
      const members = await this.prisma.loyaltyMember.findMany({ where: { id: { in: app } }, select: { id: true, tier: true } });
      for (const tier of [LoyaltyTier.BASE, LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM]) {
        groups.push({ key: `TIER:${tier}`, label: `Уровень: ${LOYALTY_TIER_LABELS_RU[tier]}`, memberIds: members.filter((m) => m.tier === tier).map((m) => m.id) });
      }
    }

    const now = new Date();
    const analytics = await this.analytics.analytics(organizationId, new Date(now.getTime() - 30 * DAY), now, DEFAULT_LOYALTY_CHURN_SETTINGS);
    if (analytics.segments.available) {
      for (const segment of LOYALTY_SEGMENTS) {
        groups.push({
          key: `SEGMENT:${segment}`,
          label: `Группа: ${LOYALTY_SEGMENT_LABELS_RU[segment as LoyaltySegment]}`,
          memberIds: analytics.segments.rows.filter((r) => r.segment === segment && inApp.has(r.memberId)).map((r) => r.memberId),
        });
      }
    }
    return groups;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  // The latest messages of a thread, oldest first.
  private async rows(memberId: string): Promise<Row[]> {
    const rows = await this.prisma.clubChatMessage.findMany({ where: { memberId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: THREAD_LIMIT });
    return rows.reverse();
  }

  private toDto(r: Row, forStaff: boolean): ClubChatMessageDto {
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      from: r.direction === ClubChatDirection.IN ? "CUSTOMER" : "BAKERY",
      kind: r.kind,
      title: r.title,
      text: r.text,
      byName: forStaff ? r.sentByName : null,
      read: r.readAt !== null,
    };
  }
}
