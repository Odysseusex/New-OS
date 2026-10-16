import { createHash } from "node:crypto";
import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Markup, Telegraf } from "telegraf";
import type { Update } from "telegraf/types";
import {
  LoyaltyConsentChannel,
  LoyaltyConsentPurpose,
  LoyaltyConsentSource,
  LoyaltyMemberStatus,
  LoyaltyTelegramStatusDto,
  normalizeKzPhone,
  SendLoyaltyTelegramResultDto,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { escapeHtml } from "../telegram/telegram-format";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { consentState } from "./loyalty.service";
import { pointsPosition } from "./points-ledger";

// The CUSTOMER bot — a separate bot from the staff one (its own token,
// CUSTOMER_BOT_TOKEN), so a buyer never sees a staff menu and the staff bot
// never has to tell the two apart. A customer links their chat by sharing their
// OWN phone number (Telegram's contact button, checked against the sender), and
// is messaged only while they are an ACTIVE member whose current consent for
// the TELEGRAM channel is granted. Pressing «Да» in the bot records that consent
// like any other (source TELEGRAM_BOT); «Отписаться» or blocking the bot records
// the withdrawal.

export interface BotTransport {
  send(chatId: string, text: string, extra?: object): Promise<void>;
}

export interface BotReply {
  text: string;
  extra?: object;
}

const BOT_NAME = "Клиент (Telegram)";
const EXPIRY_NOTICE_DAYS = 7;
const MAX_MERGE_HOPS = 10;
const DAY = 86_400_000;

const pointsFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const moneyFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric" });

const MENU = Markup.keyboard([["💰 Мои баллы"], ["🔔 Подписаться", "🔕 Отписаться"]]).resize();
const ASK_PHONE = Markup.keyboard([[Markup.button.contactRequest("📱 Отправить мой номер")]]).resize().oneTime();
const ASK_CONSENT = Markup.inlineKeyboard([
  [Markup.button.callback("Да, присылать", "lc:yes"), Markup.button.callback("Нет", "lc:no")],
]);

@Injectable()
export class CustomerBotService implements OnModuleInit {
  private readonly logger = new Logger(CustomerBotService.name);
  private bot: Telegraf | null = null;
  private transport: BotTransport | null = null;
  private username: string | null = null;

  constructor(
    private prisma: PrismaService,
    private points: LoyaltyPointsService,
  ) {}

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit() {
    const token = process.env.CUSTOMER_BOT_TOKEN;
    if (!token) {
      this.logger.warn("CUSTOMER_BOT_TOKEN not set — customer Telegram bot disabled");
      return;
    }
    const bot = new Telegraf(token);
    this.bot = bot;
    this.transport = { send: async (chatId, text, extra) => void (await bot.telegram.sendMessage(chatId, text, { parse_mode: "HTML", ...(extra ?? {}) })) };
    this.registerHandlers(bot);
    try {
      bot.botInfo = await bot.telegram.getMe();
      this.username = bot.botInfo.username;
      // Render sets RENDER_EXTERNAL_URL itself; the webhook registers on every boot,
      // so the owner only ever sets the token.
      const base = process.env.CUSTOMER_BOT_WEBHOOK_BASE_URL || process.env.RENDER_EXTERNAL_URL;
      if (base) {
        await bot.telegram.setWebhook(`${base.replace(/\/$/, "")}/api/loyalty/telegram/webhook`, { secret_token: CustomerBotService.webhookSecret() });
      }
      this.logger.log(`Customer bot ready: @${this.username}${base ? " (webhook set)" : " (no public URL — webhook not set)"}`);
    } catch (err) {
      this.logger.error("Customer bot startup failed — check CUSTOMER_BOT_TOKEN", err instanceof Error ? err.stack : String(err));
    }
  }

  // Derived from the token, so it needs no setting of its own and changes with it.
  static webhookSecret(): string {
    return createHash("sha256").update(`customer-bot:${process.env.CUSTOMER_BOT_TOKEN ?? ""}`).digest("hex").slice(0, 48);
  }

  isEnabled(): boolean {
    return this.transport !== null;
  }

  // For specs: drive the bot without Telegram.
  useTransportForTests(transport: BotTransport | null) {
    this.transport = transport;
  }

  async handleUpdate(update: Update): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.handleUpdate(update);
    } catch (err) {
      this.logger.error("Unhandled customer bot update", err instanceof Error ? err.stack : String(err));
    }
  }

  private registerHandlers(bot: Telegraf) {
    const safe = (fn: () => Promise<BotReply>, reply: (r: BotReply) => Promise<unknown>) =>
      fn()
        .then(reply)
        .catch((err) => this.logger.error("Customer bot handler failed", err instanceof Error ? err.stack : String(err)));

    bot.start((ctx) => safe(async () => this.onStart(String(ctx.chat.id)), (r) => ctx.reply(r.text, { parse_mode: "HTML", ...(r.extra ?? {}) })));
    bot.on("contact", (ctx) =>
      safe(
        async () => this.onContact(String(ctx.chat.id), String(ctx.from.id), ctx.message.contact),
        (r) => ctx.reply(r.text, { parse_mode: "HTML", ...(r.extra ?? {}) }),
      ),
    );
    bot.action(/^lc:(yes|no)$/, (ctx) =>
      safe(
        async () => {
          await ctx.answerCbQuery().catch(() => undefined);
          return this.setSubscription(String(ctx.chat?.id ?? ctx.from.id), ctx.match[1] === "yes");
        },
        (r) => ctx.reply(r.text, { parse_mode: "HTML", ...(r.extra ?? {}) }),
      ),
    );
    bot.hears("💰 Мои баллы", (ctx) => safe(async () => this.onBalance(String(ctx.chat.id)), (r) => ctx.reply(r.text, { parse_mode: "HTML", ...(r.extra ?? {}) })));
    bot.hears("🔔 Подписаться", (ctx) => safe(async () => this.setSubscription(String(ctx.chat.id), true), (r) => ctx.reply(r.text, { parse_mode: "HTML", ...(r.extra ?? {}) })));
    bot.hears("🔕 Отписаться", (ctx) => safe(async () => this.setSubscription(String(ctx.chat.id), false), (r) => ctx.reply(r.text, { parse_mode: "HTML", ...(r.extra ?? {}) })));
    bot.on("message", (ctx) => safe(async () => this.onStart(String(ctx.chat.id)), (r) => ctx.reply(r.text, { parse_mode: "HTML", ...(r.extra ?? {}) })));
  }

  // ── conversation (plain methods, so they are testable without Telegram) ────

  async onStart(chatId: string): Promise<BotReply> {
    const links = await this.linksForChat(chatId);
    if (links.length > 0) {
      return { text: "Вы уже подключены к бонусной программе. Выберите действие ниже.", extra: MENU };
    }
    return {
      text: "Здравствуйте! Здесь можно смотреть свои бонусные баллы и получать уведомления о них.\n\nНажмите кнопку ниже, чтобы отправить свой номер телефона.",
      extra: ASK_PHONE,
    };
  }

  async onContact(chatId: string, fromUserId: string, contact: { phone_number: string; user_id?: number }): Promise<BotReply> {
    // A forwarded contact card is somebody else's number.
    if (!contact.user_id || String(contact.user_id) !== fromUserId) {
      return { text: "Отправьте, пожалуйста, свой номер кнопкой «📱 Отправить мой номер».", extra: ASK_PHONE };
    }
    const phone = normalizeKzPhone(contact.phone_number);
    if (!phone) {
      return { text: "Бонусная программа работает с казахстанскими номерами. Этот номер не подходит." };
    }
    const found = await this.prisma.loyaltyMember.findMany({ where: { phone } });
    const members = (await Promise.all(found.map((m) => this.finalMember(m.id)))).filter(
      (m): m is NonNullable<typeof m> => m !== null,
    );
    const unique = [...new Map(members.map((m) => [m.id, m])).values()];
    if (unique.length === 0) {
      return { text: "Этот номер не зарегистрирован в бонусной программе. Попросите кассира зарегистрировать вас — это займёт минуту.", extra: Markup.removeKeyboard() };
    }
    const active = unique.filter((m) => m.status === LoyaltyMemberStatus.ACTIVE);
    if (active.length === 0) {
      return { text: "Вы отозвали согласие на участие в программе. Чтобы вернуться, обратитесь к кассиру.", extra: Markup.removeKeyboard() };
    }
    for (const m of active) {
      await this.prisma.loyaltyTelegramLink.upsert({
        where: { memberId: m.id },
        create: { organizationId: m.organizationId, memberId: m.id, chatId, telegramUserId: fromUserId },
        update: { chatId, telegramUserId: fromUserId, linkedAt: new Date() },
      });
    }
    const subscribed = await Promise.all(active.map((m) => this.isSubscribed(m.id)));
    if (subscribed.every(Boolean)) {
      return { text: "Готово, вы подключены. Уведомления о баллах будут приходить сюда.", extra: MENU };
    }
    await this.transport?.send(chatId, "Готово, номер подтверждён.", MENU).catch(() => undefined);
    return {
      text: "Присылать вам сюда уведомления о начисленных баллах, их сгорании и новостях пекарни?",
      extra: ASK_CONSENT,
    };
  }

  async setSubscription(chatId: string, granted: boolean): Promise<BotReply> {
    const links = await this.linksForChat(chatId);
    if (links.length === 0) return this.onStart(chatId);
    let changed = false;
    for (const link of links) {
      const member = await this.prisma.loyaltyMember.findUnique({ where: { id: link.memberId }, include: { consents: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } } });
      if (!member || member.status !== LoyaltyMemberStatus.ACTIVE) continue;
      const before = consentState(member.consents);
      if (before.marketing.TELEGRAM === granted) continue;
      await this.recordTelegramConsent(member.organizationId, member.id, granted, before, null);
      changed = true;
    }
    if (granted) {
      return { text: changed ? "Спасибо! Уведомления включены. Отписаться можно в любой момент кнопкой «🔕 Отписаться»." : "Уведомления уже включены.", extra: MENU };
    }
    return { text: changed ? "Уведомления отключены. Свои баллы вы по-прежнему можете смотреть здесь." : "Уведомления уже отключены.", extra: MENU };
  }

  async onBalance(chatId: string): Promise<BotReply> {
    const links = await this.linksForChat(chatId);
    if (links.length === 0) return this.onStart(chatId);
    const lines: string[] = [];
    for (const link of links) {
      const rows = await this.prisma.loyaltyPointsEntry.findMany({ where: { memberId: link.memberId } });
      const position = pointsPosition(
        rows.map((r) => ({ id: r.id, type: r.type, points: r.points.toNumber(), expiresAt: r.expiresAt, createdAt: r.createdAt })),
        new Date(),
      );
      lines.push(`На счёте: <b>${pointsFmt.format(position.available)}</b> баллов (1 балл = 1 ₸).`);
      const soon = position.liveLots[0];
      if (soon) lines.push(`${pointsFmt.format(soon.remaining)} из них сгорят ${dateFmt.format(soon.expiresAt)}.`);
    }
    return { text: lines.join("\n"), extra: MENU };
  }

  // ── messages to members ──────────────────────────────────────────────────

  // After a sale or a return: what moved and what is left. Never throws — a
  // message is a courtesy, it must not trouble the till.
  async notifyPoints(memberId: string, key: string, headline: string, redeemed: number, earned: number): Promise<void> {
    try {
      if (redeemed <= 0 && earned <= 0) return;
      const balance = (await this.points.balances((await this.orgOf(memberId)) ?? "", [memberId])).get(memberId) ?? 0;
      const parts = [headline];
      if (redeemed > 0) parts.push(`Оплачено баллами: ${pointsFmt.format(redeemed)}`);
      if (earned > 0) parts.push(`Начислено: +${pointsFmt.format(earned)}`);
      parts.push(`На счёте: <b>${pointsFmt.format(balance)}</b> баллов`);
      await this.sendToMember(memberId, parts.join("\n"), key, null);
    } catch (err) {
      this.logger.error(`Points notification for ${memberId} failed`, err instanceof Error ? err.stack : String(err));
    }
  }

  async notifySale(sale: { id: string; totalAmount: number; loyalty: { memberId: string; pointsRedeemed: number; pointsEarned: number } | null }) {
    if (!sale.loyalty || !this.isEnabled()) return;
    await this.notifyPoints(
      sale.loyalty.memberId,
      `sale:${sale.id}`,
      `Спасибо за покупку на ${moneyFmt.format(sale.totalAmount)} ₸!`,
      sale.loyalty.pointsRedeemed,
      sale.loyalty.pointsEarned,
    );
  }

  async notifyReturn(memberId: string, saleReturnId: string, refunded: number, reversed: number) {
    if (!this.isEnabled() || (refunded <= 0 && reversed <= 0)) return;
    try {
      const balance = (await this.points.balances((await this.orgOf(memberId)) ?? "", [memberId])).get(memberId) ?? 0;
      const parts = ["Оформлен возврат товара."];
      if (refunded > 0) parts.push(`Баллы, которыми вы платили, вернулись: +${pointsFmt.format(refunded)}`);
      if (reversed > 0) parts.push(`Начисление за возвращённый товар отменено: −${pointsFmt.format(reversed)}`);
      parts.push(`На счёте: <b>${pointsFmt.format(balance)}</b> баллов`);
      await this.sendToMember(memberId, parts.join("\n"), `return:${saleReturnId}`, null);
    } catch (err) {
      this.logger.error(`Return notification for ${memberId} failed`, err instanceof Error ? err.stack : String(err));
    }
  }

  // Once a day (12:05 Almaty — the server is likely awake then; on a sleeping free
  // instance a missed day is caught up the next one, the key prevents repeats).
  @Cron("5 7 * * *")
  async remindExpiringPoints(): Promise<number> {
    if (!this.isEnabled()) return 0;
    const links = await this.prisma.loyaltyTelegramLink.findMany({ select: { memberId: true } });
    const now = new Date();
    let sent = 0;
    for (const { memberId } of links) {
      try {
        const rows = await this.prisma.loyaltyPointsEntry.findMany({ where: { memberId } });
        const position = pointsPosition(
          rows.map((r) => ({ id: r.id, type: r.type, points: r.points.toNumber(), expiresAt: r.expiresAt, createdAt: r.createdAt })),
          now,
        );
        const soon = position.liveLots.filter((l) => l.expiresAt.getTime() - now.getTime() <= EXPIRY_NOTICE_DAYS * DAY);
        if (soon.length === 0) continue;
        const amount = soon.reduce((s, l) => s + l.remaining, 0);
        if (amount < 1) continue;
        const first = soon[0].expiresAt;
        const text = `${pointsFmt.format(amount)} ваших баллов сгорят ${dateFmt.format(first)}. Приходите — оплатите ими часть покупки!`;
        if (await this.sendToMember(memberId, text, `expiry:${first.toISOString().slice(0, 10)}`, null)) sent += 1;
      } catch (err) {
        this.logger.error(`Expiry reminder for ${memberId} failed`, err instanceof Error ? err.stack : String(err));
      }
    }
    return sent;
  }

  // A message written by the owner (e.g. to the churn radar list).
  async sendManual(user: AuthenticatedUser, memberIds: string[], text: string): Promise<SendLoyaltyTelegramResultDto> {
    if (!this.isEnabled()) throw new BadRequestException("Telegram-бот для клиентов не подключён");
    const clean = text.trim();
    const members = await this.prisma.loyaltyMember.findMany({ where: { id: { in: [...new Set(memberIds)] }, organizationId: user.organizationId }, select: { id: true } });
    const key = `manual:${Date.now()}`;
    let sent = 0;
    for (const m of members) {
      if (await this.sendToMember(m.id, escapeHtml(clean), key, user.id)) sent += 1;
    }
    return { sent, skipped: memberIds.length - sent };
  }

  async status(organizationId: string): Promise<LoyaltyTelegramStatusDto> {
    const links = await this.prisma.loyaltyTelegramLink.findMany({ where: { organizationId }, select: { memberId: true } });
    const reachable = await this.reachableIds(links.map((l) => l.memberId));
    return { enabled: this.isEnabled(), username: this.username, linkedMembers: links.length, reachableMembers: reachable.size };
  }

  // Who can be messaged right now: linked, ACTIVE, TELEGRAM consent granted.
  async reachableIds(memberIds: string[]): Promise<Set<string>> {
    if (memberIds.length === 0) return new Set();
    const members = await this.prisma.loyaltyMember.findMany({
      where: { id: { in: memberIds }, status: LoyaltyMemberStatus.ACTIVE, telegramLink: { isNot: null } },
      include: { consents: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } },
    });
    return new Set(members.filter((m) => consentState(m.consents).marketing.TELEGRAM).map((m) => m.id));
  }

  // The single gate every outgoing message passes. Returns whether it went out.
  async sendToMember(memberId: string, text: string, key: string, sentById: string | null): Promise<boolean> {
    if (!this.transport) return false;
    const reachable = await this.reachableIds([memberId]);
    if (!reachable.has(memberId)) return false;
    const link = await this.prisma.loyaltyTelegramLink.findUnique({ where: { memberId } });
    if (!link) return false;
    // Claim the key first: two parallel attempts never both send.
    try {
      await this.prisma.loyaltyMessageLog.create({ data: { organizationId: link.organizationId, memberId, key, text, sentById } });
    } catch {
      return false;
    }
    try {
      await this.transport.send(link.chatId, text);
      return true;
    } catch (err) {
      const code = (err as { response?: { error_code?: number } }).response?.error_code;
      if (code === 403) {
        // The customer blocked the bot: that is a withdrawal, recorded as one.
        await this.prisma.loyaltyTelegramLink.delete({ where: { memberId } }).catch(() => undefined);
        const member = await this.prisma.loyaltyMember.findUnique({ where: { id: memberId }, include: { consents: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } } });
        if (member) await this.recordTelegramConsent(member.organizationId, memberId, false, consentState(member.consents), "Клиент заблокировал бота");
      }
      await this.prisma.loyaltyMessageLog.deleteMany({ where: { memberId, key } }).catch(() => undefined);
      this.logger.warn(`Message to member ${memberId} not delivered (${code ?? "error"})`);
      return false;
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async recordTelegramConsent(
    organizationId: string,
    memberId: string,
    granted: boolean,
    before: ReturnType<typeof consentState>,
    note: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyConsent.create({
        data: {
          organizationId,
          memberId,
          purpose: LoyaltyConsentPurpose.MARKETING,
          channel: LoyaltyConsentChannel.TELEGRAM,
          granted,
          source: LoyaltyConsentSource.TELEGRAM_BOT,
          recordedByName: BOT_NAME,
          note,
        },
      });
      await recordAudit(tx, {
        organizationId,
        actorId: null,
        action: "loyaltyMember.consent",
        entityType: "LoyaltyMember",
        entityId: memberId,
        before: { consents: before },
        after: { consents: { ...before, marketing: { ...before.marketing, TELEGRAM: granted } }, source: LoyaltyConsentSource.TELEGRAM_BOT },
        reason: note,
      });
    });
  }

  private async isSubscribed(memberId: string): Promise<boolean> {
    const consents = await this.prisma.loyaltyConsent.findMany({ where: { memberId }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });
    return consentState(consents).marketing.TELEGRAM;
  }

  private linksForChat(chatId: string) {
    return this.prisma.loyaltyTelegramLink.findMany({ where: { chatId } });
  }

  private async orgOf(memberId: string): Promise<string | null> {
    return (await this.prisma.loyaltyMember.findUnique({ where: { id: memberId }, select: { organizationId: true } }))?.organizationId ?? null;
  }

  private async finalMember(memberId: string) {
    let current = await this.prisma.loyaltyMember.findUnique({ where: { id: memberId } });
    for (let hop = 0; current?.mergedIntoId && hop < MAX_MERGE_HOPS; hop += 1) {
      current = await this.prisma.loyaltyMember.findUnique({ where: { id: current.mergedIntoId } });
    }
    return current;
  }
}
