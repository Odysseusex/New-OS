import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import {
  CLUB_LOGIN_TTL_MINUTES,
  ClubHistoryItemDto,
  ClubInfoDto,
  ClubLoginStatusDto,
  ClubProfileDto,
  ClubProgrammeDto,
  clubLoginMessage,
  LoyaltyMemberStatus,
  LoyaltyPointsEntryType as T,
  normalizeKzPhone,
  StartClubLoginDto,
  StartClubLoginRequestDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { memberTier } from "../loyalty/loyalty-tier";
import { LoyaltyPointsService } from "../loyalty/loyalty-points.service";
import { WhatsAppService } from "../loyalty/whatsapp.service";
import { CustomerBotService } from "../loyalty/customer-bot.service";
import { newCardSecret } from "./club-confirm";
import { signClubToken } from "./club-token";

export const BRAND = "Ar Amir";

// A signed-in customer, as the guard resolves it.
export interface ClubSession {
  sessionId: string;
  organizationId: string;
  memberId: string;
}

const PER_PHONE_LIMIT = 5;
const PER_PHONE_WINDOW_MS = 15 * 60_000;
const PENDING_LIMIT = 500;
const HISTORY_LIMIT = 60;
const SEEN_EVERY_MS = 60 * 60_000;
const MAX_MERGE_DEPTH = 5;

const round2 = (v: number) => Math.round(v * 100) / 100;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

@Injectable()
export class ClubService {
  private org: { id: string; at: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private points: LoyaltyPointsService,
    private whatsapp: WhatsAppService,
    private bot: CustomerBotService,
  ) {}

  // ── which business this app belongs to ─────────────────────────────────────
  // One app for one business: CLUB_ORGANIZATION_ID when set, otherwise the real
  // (non-sandbox) organization running the bonus programme.
  async organizationId(): Promise<string> {
    const fromEnv = (process.env.CLUB_ORGANIZATION_ID ?? "").trim();
    if (fromEnv) return fromEnv;
    if (this.org && Date.now() - this.org.at < 5 * 60_000) return this.org.id;
    const orgs = await this.prisma.organization.findMany({ where: { demoParentId: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    if (orgs.length === 0) throw new NotFoundException("Приложение не настроено");
    const running = await this.prisma.loyaltySettings.findMany({ where: { enabled: true, organizationId: { in: orgs.map((o) => o.id) } }, select: { organizationId: true } });
    const id = running.length === 1 ? running[0].organizationId : orgs[0].id;
    this.org = { id, at: Date.now() };
    return id;
  }

  async info(): Promise<ClubInfoDto> {
    const organizationId = await this.organizationId();
    const settings = await this.points.getSettings(organizationId);
    const whatsapp = settings.clubWhatsappLogin && (await this.whatsapp.businessPhoneDigits()) !== null;
    const telegram = this.bot.botUsername() !== null;
    return { brand: BRAND, ready: settings.enabled && (whatsapp || telegram), whatsapp, telegram, programme: this.programme(settings) };
  }

  // ── sign-in ───────────────────────────────────────────────────────────────

  async startLogin(dto: StartClubLoginRequestDto): Promise<StartClubLoginDto> {
    const phone = normalizeKzPhone(dto.phone);
    if (!phone) throw new BadRequestException("Введите казахстанский номер, например +7 701 123 45 67");
    if (!dto.consent) throw new BadRequestException("Без согласия на обработку персональных данных вход невозможен");
    const name = (dto.name ?? "").trim().slice(0, 60) || null;

    const organizationId = await this.organizationId();
    const settings = await this.points.getSettings(organizationId);
    // WhatsApp only once the owner switched it on (the webhook in Meta must work).
    const waDigits = settings.clubWhatsappLogin ? await this.whatsapp.businessPhoneDigits() : null;
    const botName = this.bot.botUsername();
    if (!settings.enabled || (!waDigits && !botName)) throw new BadRequestException("Вход временно недоступен. Попробуйте позже.");

    const now = Date.now();
    const recent = await this.prisma.clubLoginRequest.count({ where: { phone, createdAt: { gt: new Date(now - PER_PHONE_WINDOW_MS) } } });
    if (recent >= PER_PHONE_LIMIT) throw new HttpException("Слишком много попыток входа. Попробуйте через 15 минут.", HttpStatus.TOO_MANY_REQUESTS);
    const live = await this.prisma.clubLoginRequest.count({ where: { status: "PENDING", expiresAt: { gt: new Date(now) } } });
    if (live >= PENDING_LIMIT) throw new HttpException("Сейчас слишком много входов. Попробуйте через несколько минут.", HttpStatus.TOO_MANY_REQUESTS);

    // Six digits, not shared with any other live sign-in.
    let code = "";
    for (let attempt = 0; attempt < 10 && !code; attempt += 1) {
      const candidate = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const taken = await this.prisma.clubLoginRequest.count({ where: { code: candidate, status: "PENDING", expiresAt: { gt: new Date(now) } } });
      if (taken === 0) code = candidate;
    }
    if (!code) throw new HttpException("Попробуйте ещё раз через минуту.", HttpStatus.SERVICE_UNAVAILABLE);

    const secret = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now + CLUB_LOGIN_TTL_MINUTES * 60_000);
    const request = await this.prisma.clubLoginRequest.create({
      data: { organizationId, phone, code, secretHash: sha256(secret), name, marketing: !!dto.marketing, expiresAt },
    });
    return {
      requestId: request.id,
      secret,
      code,
      expiresAt: expiresAt.toISOString(),
      whatsappUrl: waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(clubLoginMessage(code))}` : null,
      telegramUrl: botName ? `https://t.me/${botName}?start=in_${code}` : null,
    };
  }

  // Polled by the app. A confirmed sign-in is handed over exactly once, and only
  // to the browser holding the secret.
  async loginStatus(requestId: string, secret: string): Promise<ClubLoginStatusDto> {
    const request = await this.prisma.clubLoginRequest.findUnique({ where: { id: requestId } });
    const given = Buffer.from(sha256(secret ?? ""));
    if (!request || !timingSafeEqual(given, Buffer.from(request.secretHash))) throw new NotFoundException("Вход не найден");
    if (request.status === "PENDING") return { status: request.expiresAt.getTime() > Date.now() ? "PENDING" : "EXPIRED" };
    if (request.status !== "CONFIRMED") return { status: "USED" };
    const taken = await this.prisma.clubLoginRequest.updateMany({
      where: { id: request.id, status: "CONFIRMED" },
      data: { status: "USED", usedAt: new Date(), lastSeenAt: new Date() },
    });
    return taken.count === 1 ? { status: "CONFIRMED", token: signClubToken(request.id) } : { status: "USED" };
  }

  // The session behind a token, or 401. A merged record leads to its primary.
  async session(sessionId: string): Promise<ClubSession> {
    const row = await this.prisma.clubLoginRequest.findUnique({ where: { id: sessionId } });
    if (!row || row.status !== "USED" || !row.memberId) throw new UnauthorizedException("Войдите заново");
    let member = await this.prisma.loyaltyMember.findUnique({ where: { id: row.memberId } });
    for (let hop = 0; member?.mergedIntoId && hop < 10; hop += 1) {
      member = await this.prisma.loyaltyMember.findUnique({ where: { id: member.mergedIntoId } });
    }
    if (!member) throw new UnauthorizedException("Войдите заново");
    if (member.status !== LoyaltyMemberStatus.ACTIVE) {
      throw new UnauthorizedException("Вы отозвали согласие на участие в программе. Чтобы вернуться, войдите заново.");
    }
    if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      await this.prisma.clubLoginRequest.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
    }
    return { sessionId: row.id, organizationId: member.organizationId, memberId: member.id };
  }

  async logout(session: ClubSession): Promise<{ loggedOut: true }> {
    await this.prisma.clubLoginRequest.updateMany({ where: { id: session.sessionId, status: "USED" }, data: { status: "REVOKED" } });
    return { loggedOut: true };
  }

  // ── the card ──────────────────────────────────────────────────────────────

  async profile(session: ClubSession): Promise<ClubProfileDto> {
    const { organizationId, memberId } = session;
    // Opening the card writes off what has expired, like opening it at the till.
    await this.points.settleOutside(organizationId, memberId);
    let member = await this.prisma.loyaltyMember.findUniqueOrThrow({ where: { id: memberId } });
    if (!member.cardSecret) {
      member = await this.prisma.loyaltyMember.update({ where: { id: memberId }, data: { cardSecret: newCardSecret() } });
    }
    const ids = await this.withMerged(memberId);
    const [settings, positions, sales, returns, entries] = await Promise.all([
      this.points.getSettings(organizationId),
      this.points.positions(organizationId, [memberId]),
      this.prisma.sale.findMany({
        where: { loyaltyMemberId: { in: ids } },
        orderBy: { soldAt: "desc" },
        take: HISTORY_LIMIT,
        select: { id: true, soldAt: true, totalAmount: true, location: { select: { name: true } } },
      }),
      this.prisma.saleReturn.findMany({
        where: { sale: { loyaltyMemberId: { in: ids } } },
        orderBy: { returnedAt: "desc" },
        take: HISTORY_LIMIT,
        select: { id: true, returnedAt: true, totalAmount: true, location: { select: { name: true } } },
      }),
      this.prisma.loyaltyPointsEntry.findMany({
        where: { memberId: { in: ids } },
        orderBy: { createdAt: "desc" },
        take: 400,
        select: { id: true, type: true, points: true, saleId: true, saleReturnId: true, createdAt: true },
      }),
    ]);
    const position = positions.get(memberId);
    const bySale = new Map<string, number>();
    const byReturn = new Map<string, number>();
    const items: ClubHistoryItemDto[] = [];
    for (const e of entries) {
      const pts = e.points.toNumber();
      if (e.saleId) bySale.set(e.saleId, (bySale.get(e.saleId) ?? 0) + pts);
      else if (e.saleReturnId) byReturn.set(e.saleReturnId, (byReturn.get(e.saleReturnId) ?? 0) + pts);
      else if (e.type === T.BIRTHDAY) items.push(this.item(e.id, e.createdAt, "BONUS", "Подарок на день рождения", null, null, pts));
      else if (e.type === T.EXPIRE) items.push(this.item(e.id, e.createdAt, "EXPIRED", "Сгорели бонусы", null, null, pts));
      else if (e.type === T.ADJUSTMENT) items.push(this.item(e.id, e.createdAt, "ADJUSTMENT", pts > 0 ? "Начисление от пекарни" : "Корректировка бонусов", null, null, pts));
    }
    for (const s of sales) {
      items.push(this.item(s.id, s.soldAt, "PURCHASE", "Покупка", s.location.name, s.totalAmount.toNumber(), bySale.has(s.id) ? round2(bySale.get(s.id)!) : null));
    }
    for (const r of returns) {
      items.push(this.item(r.id, r.returnedAt, "RETURN", "Возврат", r.location.name, -r.totalAmount.toNumber(), byReturn.has(r.id) ? round2(byReturn.get(r.id)!) : null));
    }
    items.sort((a, b) => b.at.localeCompare(a.at));

    const now = Date.now();
    const soon = position?.liveLots.find((l) => !l.availableAt || l.availableAt.getTime() <= now) ?? null;
    const visits = await this.prisma.sale.count({ where: { loyaltyMemberId: { in: ids } } });
    return {
      name: member.name,
      phone: member.phone,
      memberSince: member.createdAt.toISOString(),
      balance: round2(position?.available ?? 0),
      pending: position && position.pending > 0 && position.pendingFrom ? { points: round2(position.pending), from: position.pendingFrom.toISOString() } : null,
      expiring: soon ? { points: round2(soon.remaining), at: soon.expiresAt.toISOString() } : null,
      card: { secret: member.cardSecret! },
      serverTime: new Date().toISOString(),
      visits,
      tier: await memberTier(this.prisma, memberId, settings),
      programme: this.programme(settings),
      history: items.slice(0, HISTORY_LIMIT),
    };
  }

  async rename(session: ClubSession, rawName: string): Promise<{ name: string | null }> {
    const name = (rawName ?? "").trim().slice(0, 60) || null;
    await this.prisma.loyaltyMember.update({ where: { id: session.memberId }, data: { name } });
    return { name };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private programme(s: Awaited<ReturnType<LoyaltyPointsService["getSettings"]>>): ClubProgrammeDto {
    return {
      enabled: s.enabled,
      earnPercent: s.earnPercent,
      maxRedeemPercent: s.maxRedeemPercent,
      pointsLifetimeMonths: s.pointsLifetimeMonths,
      welcomeBonusPoints: s.welcomeBonusPoints,
      welcomeBonusDays: s.welcomeBonusDays,
      birthdayBonusPoints: s.birthdayBonusPoints,
      tiers: s.tiersEnabled
        ? {
            windowDays: s.tierWindowDays,
            silver: { threshold: s.silverThreshold, percent: s.silverPercent },
            gold: { threshold: s.goldThreshold, percent: s.goldPercent },
            platinum: { threshold: s.platinumThreshold, percent: s.platinumPercent },
          }
        : null,
    };
  }

  private item(id: string, at: Date, kind: ClubHistoryItemDto["kind"], title: string, place: string | null, amount: number | null, points: number | null): ClubHistoryItemDto {
    return { id, at: at.toISOString(), kind, title, place, amount, points: points === null ? null : round2(points) };
  }

  // The member and every record merged into it (their purchases are theirs).
  private async withMerged(memberId: string): Promise<string[]> {
    const ids = [memberId];
    let frontier = [memberId];
    for (let depth = 0; depth < MAX_MERGE_DEPTH && frontier.length > 0; depth += 1) {
      const children = await this.prisma.loyaltyMember.findMany({ where: { mergedIntoId: { in: frontier } }, select: { id: true } });
      frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }
    return ids;
  }
}
