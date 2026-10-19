import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  LoyaltyConsentChannel,
  LoyaltyConsentSource,
  LoyaltyMemberStatus,
  LoyaltyMessageStatus,
  LoyaltyWhatsAppStatusDto,
  LoyaltyWhatsAppTemplateDto,
  LoyaltyWhatsAppTemplateStatus,
  normalizeKzPhone,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { recordChannelConsent } from "./channel-consent";
import { consentState } from "./loyalty.service";
import { pointsPosition } from "./points-ledger";

// WhatsApp through Meta's own Cloud API (no intermediary). Everything we send
// first is a pre-approved template — Meta refuses free text outside the 24 hours
// after a customer last wrote to us — so the templates below are submitted to
// Meta from the programme card and a message goes out only once its template is
// APPROVED. Like the Telegram bot, a message reaches only an ACTIVE member whose
// current consent for the WHATSAPP channel is granted, and «СТОП» (or Meta's own
// «stop marketing» button) is recorded as a withdrawal.

export class WhatsAppApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
  }
}

export interface WhatsAppTransport {
  request(method: "GET" | "POST", path: string, body?: unknown): Promise<any>;
}

export const WHATSAPP_LANGUAGE = "ru";
const FOOTER = "Чтобы отписаться, ответьте СТОП";

export const WHATSAPP_TEMPLATES = {
  purchase: {
    name: "ar_purchase_points",
    category: "UTILITY",
    purpose: "После покупки",
    text: "Спасибо за покупку на {{1}} ₸! Начислено баллов: {{2}}, оплачено баллами: {{3}}. На вашем счёте: {{4}} баллов.",
    example: ["1 250", "12,5", "0", "312,5"],
  },
  return: {
    name: "ar_return_points",
    category: "UTILITY",
    purpose: "После возврата",
    text: "Оформлен возврат товара. Вернулось баллов: {{1}}, отменено начисление: {{2}}. На вашем счёте: {{3}} баллов.",
    example: ["50", "4,2", "120"],
  },
  expiring: {
    name: "ar_points_expiring",
    category: "UTILITY",
    purpose: "Баллы скоро сгорят",
    text: "Напоминаем: {{1}} ваших бонусных баллов сгорят {{2}}. Оплатите ими часть следующей покупки.",
    example: ["150", "25.11.2026"],
  },
  birthday: {
    name: "ar_birthday_gift",
    category: "MARKETING",
    purpose: "День рождения",
    text: "С днём рождения, {{1}}! Дарим вам {{2}} бонусных баллов, потратьте их до {{3}}. Ждём вас!",
    example: ["Айгуль", "500", "03.09.2026"],
  },
  news: {
    name: "ar_news",
    category: "MARKETING",
    purpose: "Сообщение от вас",
    text: "Здравствуйте! {{1}} Ждём вас в наших пекарнях.",
    example: ["На этой неделе скидка 20% на все торты."],
  },
} as const;

export type WhatsAppTemplateKey = keyof typeof WHATSAPP_TEMPLATES;

const SETTINGS = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_APP_SECRET"] as const;
const CUSTOMER_NAME = "Клиент (WhatsApp)";
const CACHE_MS = 10 * 60_000;
const MAX_MERGE_HOPS = 10;
const DAY = 86_400_000;
// Failures that will not change on a retry: keep the row (it says why).
const RECIPIENT_FAILURES = new Set([131050, 131026]);
const STOP_MARKETING = 131050;
const STOP_WORDS = new Set(["стоп", "stop", "отписаться", "отписка", "отпишите"]);
const START_WORDS = new Set(["старт", "start", "подписаться"]);
const RANK: Record<LoyaltyMessageStatus, number> = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

const pointsFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric" });

// In Russian, for the member card; Meta's own text is kept for anything unknown.
export function describeWhatsAppFailure(code: number | null, message: string): string {
  switch (code) {
    case 131050:
      return "Клиент отключил сообщения от компаний в WhatsApp";
    case 131026:
      return "Номера нет в WhatsApp, или у клиента устаревшее приложение";
    case 131049:
      return "Meta придержала сообщение: лимит рекламных сообщений этому клиенту";
    case 131047:
      return "Прошло больше суток с последнего сообщения клиента";
    case 132001:
      return "Шаблон сообщения не одобрен Meta";
    case 190:
      return "Ключ WhatsApp не принят: срок истёк или ключ неверный";
    default:
      return `Ошибка WhatsApp${code ? ` ${code}` : ""}: ${message}`;
  }
}

// Meta refuses line breaks, tabs and runs of spaces inside a parameter.
const cleanParam = (value: string) => value.replace(/\s+/g, " ").trim() || "—";

export function renderTemplate(key: WhatsAppTemplateKey, params: string[]): string {
  return WHATSAPP_TEMPLATES[key].text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => cleanParam(params[Number(n) - 1] ?? ""));
}

type TemplateState = { status: LoyaltyWhatsAppTemplateStatus; rejectedReason: string | null };

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private transport: WhatsAppTransport | null = null;
  private problem: string | null = null;
  private templates: { at: number; byName: Map<string, TemplateState> } | null = null;
  private phoneInfo: { at: number; phone: string | null; verifiedName: string | null; qualityRating: string | null } | null = null;

  constructor(private prisma: PrismaService) {
    const cfg = WhatsAppService.config();
    if (WhatsAppService.missingSettings().length === 0) {
      this.transport = WhatsAppService.graphTransport(cfg.token as string, cfg.version);
    }
  }

  // ── configuration ─────────────────────────────────────────────────────────

  // Keys never contain whitespace; a stray space from copy-paste is dropped.
  static config() {
    const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, "") || null;
    return {
      token: clean(process.env.WHATSAPP_TOKEN),
      phoneNumberId: clean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      businessAccountId: clean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
      appSecret: clean(process.env.WHATSAPP_APP_SECRET),
      version: clean(process.env.WHATSAPP_GRAPH_VERSION) ?? "v23.0",
    };
  }

  static missingSettings(): string[] {
    return SETTINGS.filter((name) => !(process.env[name] ?? "").trim());
  }

  // What the owner types into Meta's webhook form. Derived, so it needs no
  // setting of its own, and changes with the app secret.
  static verifyToken(): string {
    return createHash("sha256").update(`whatsapp-verify:${WhatsAppService.config().appSecret ?? ""}`).digest("hex").slice(0, 32);
  }

  private static graphTransport(token: string, version: string): WhatsAppTransport {
    return {
      async request(method, path, body) {
        const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
        if (!res.ok || json.error) throw new WhatsAppApiError(res.status, json.error?.code ?? null, json.error?.message ?? `HTTP ${res.status}`);
        return json;
      },
    };
  }

  isEnabled(): boolean {
    return this.transport !== null;
  }

  // For specs: talk to a fake Meta.
  useTransportForTests(transport: WhatsAppTransport | null) {
    this.transport = transport;
    this.templates = null;
    this.phoneInfo = null;
    this.problem = null;
  }

  // ── sending ───────────────────────────────────────────────────────────────

  // The single gate for everything we send first. Returns whether it went out.
  async sendTemplate(memberId: string, key: WhatsAppTemplateKey, params: string[], logKey: string, sentById: string | null): Promise<boolean> {
    if (!this.transport) return false;
    const template = WHATSAPP_TEMPLATES[key];
    if (params.length !== template.example.length) throw new Error(`Template ${template.name} takes ${template.example.length} parameters`);
    if (!(await this.reachableIds([memberId])).has(memberId)) return false;
    // Not approved yet (or Meta could not be asked): nothing is sent and nothing
    // is claimed, so the same message can still go once the template is approved.
    if ((await this.templateStates())?.get(template.name)?.status !== "APPROVED") return false;
    const member = await this.prisma.loyaltyMember.findUnique({ where: { id: memberId }, select: { organizationId: true, phone: true } });
    if (!member) return false;
    const text = renderTemplate(key, params);
    const key2 = `wa:${logKey}`;
    try {
      await this.prisma.loyaltyMessageLog.create({
        data: { organizationId: member.organizationId, memberId, key: key2, text, sentById, channel: LoyaltyConsentChannel.WHATSAPP },
      });
    } catch {
      return false; // already sent (or being sent) under this key
    }
    try {
      const res = await this.transport.request("POST", `${this.phoneNumberId()}/messages`, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: member.phone.replace(/^\+/, ""),
        type: "template",
        template: {
          name: template.name,
          language: { code: WHATSAPP_LANGUAGE },
          components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: cleanParam(p) })) }],
        },
      });
      const id: string | undefined = res?.messages?.[0]?.id;
      await this.prisma.loyaltyMessageLog.updateMany({
        where: { memberId, key: key2 },
        data: { providerMessageId: id ?? null, status: LoyaltyMessageStatus.SENT, statusAt: new Date() },
      });
      return true;
    } catch (err) {
      const code = err instanceof WhatsAppApiError ? err.code : null;
      const message = err instanceof Error ? err.message : String(err);
      if (code !== null && RECIPIENT_FAILURES.has(code)) {
        await this.prisma.loyaltyMessageLog.updateMany({
          where: { memberId, key: key2 },
          data: { status: LoyaltyMessageStatus.FAILED, statusAt: new Date(), error: describeWhatsAppFailure(code, message) },
        });
        if (code === STOP_MARKETING) await this.setConsent([memberId], false, "Клиент отключил сообщения от компаний в WhatsApp");
      } else {
        // Anything else may pass later (a rate limit, Meta down, a template
        // re-approved): release the key so the same message can be retried.
        await this.prisma.loyaltyMessageLog.deleteMany({ where: { memberId, key: key2 } });
        if (code === 190 || (err instanceof WhatsAppApiError && err.httpStatus === 401)) this.problem = describeWhatsAppFailure(190, message);
        if (code === 132001) this.templates = null;
      }
      this.logger.warn(`WhatsApp ${template.name} to member ${memberId} not sent (${code ?? "error"}: ${message})`);
      return false;
    }
  }

  // A reply within 24 hours of the customer's own message: free text is allowed
  // and it needs no consent (they wrote to us).
  private async reply(waId: string, text: string): Promise<void> {
    if (!this.transport) return;
    await this.transport
      .request("POST", `${this.phoneNumberId()}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: waId, type: "text", text: { body: text } })
      .catch((err) => this.logger.warn(`WhatsApp reply to ${waId} failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  // ACTIVE and the current WHATSAPP consent granted — the phone is the address.
  async reachableIds(memberIds: string[]): Promise<Set<string>> {
    if (memberIds.length === 0) return new Set();
    const members = await this.prisma.loyaltyMember.findMany({
      where: { id: { in: memberIds }, status: LoyaltyMemberStatus.ACTIVE },
      include: { consents: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } },
    });
    return new Set(members.filter((m) => consentState(m.consents).marketing.WHATSAPP).map((m) => m.id));
  }

  // Every member who can be written to (optionally in one organization).
  async reachableMemberIds(organizationId?: string): Promise<string[]> {
    const rows = await this.prisma.loyaltyConsent.findMany({
      where: { channel: LoyaltyConsentChannel.WHATSAPP, granted: true, ...(organizationId ? { organizationId } : {}) },
      select: { memberId: true },
      distinct: ["memberId"],
    });
    return [...(await this.reachableIds(rows.map((r) => r.memberId)))];
  }

  // ── webhook (Meta → us) ───────────────────────────────────────────────────

  // The GET handshake when the owner saves the webhook in Meta.
  verifySubscription(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
    if (mode !== "subscribe" || !challenge || !WhatsAppService.config().appSecret) return null;
    const expected = Buffer.from(WhatsAppService.verifyToken());
    const given = Buffer.from(token ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected) ? challenge : null;
  }

  // Every POST is signed with the app secret over the raw body.
  static checkSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
    const secret = WhatsAppService.config().appSecret;
    if (!secret || !rawBody || !header?.startsWith("sha256=")) return false;
    const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
    const given = Buffer.from(header.slice("sha256=".length));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async handleWebhook(payload: any): Promise<void> {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        try {
          if (change?.field === "messages") {
            for (const status of value.statuses ?? []) await this.onStatus(status);
            for (const message of value.messages ?? []) await this.onMessage(message);
          } else if (change?.field === "user_preferences") {
            for (const pref of value.user_preferences ?? []) {
              if (pref?.category === "marketing_messages" && pref?.value === "stop") {
                await this.setConsent(await this.membersByWaId(String(pref.wa_id ?? "")), false, "Клиент отключил сообщения от компаний в WhatsApp");
              }
            }
          }
        } catch (err) {
          this.logger.error("WhatsApp webhook change failed", err instanceof Error ? err.stack : String(err));
        }
      }
    }
  }

  private async onStatus(status: any): Promise<void> {
    const next = String(status?.status ?? "").toUpperCase() as LoyaltyMessageStatus;
    if (!RANK[next] || !status?.id) return;
    const log = await this.prisma.loyaltyMessageLog.findFirst({ where: { providerMessageId: String(status.id) } });
    if (!log) return;
    // Reports can arrive out of order: «read» never goes back to «delivered».
    if (log.status && RANK[log.status as LoyaltyMessageStatus] >= RANK[next]) return;
    const error = status.errors?.[0];
    const code = typeof error?.code === "number" ? error.code : null;
    await this.prisma.loyaltyMessageLog.update({
      where: { id: log.id },
      data: {
        status: next,
        statusAt: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
        error: next === LoyaltyMessageStatus.FAILED ? describeWhatsAppFailure(code, String(error?.message ?? error?.title ?? "")) : null,
      },
    });
    if (next === LoyaltyMessageStatus.FAILED && code === STOP_MARKETING) {
      await this.setConsent([log.memberId], false, "Клиент отключил сообщения от компаний в WhatsApp");
    }
  }

  private async onMessage(message: any): Promise<void> {
    const waId = String(message?.from ?? "");
    if (!waId) return;
    const body: string = message?.text?.body ?? message?.button?.text ?? message?.interactive?.button_reply?.title ?? "";
    const memberIds = await this.membersByWaId(waId);
    if (memberIds.length === 0) {
      await this.reply(waId, "Этот номер не зарегистрирован в бонусной программе. Попросите кассира зарегистрировать вас — это займёт минуту.");
      return;
    }
    // Meta may deliver the same message twice: handle it once.
    const first = await this.prisma.loyaltyMember.findUnique({ where: { id: memberIds[0] }, select: { organizationId: true } });
    if (!first) return;
    try {
      await this.prisma.loyaltyMessageLog.create({
        data: { organizationId: first.organizationId, memberId: memberIds[0], key: `wa-in:${message.id}`, text: body.slice(0, 1000), channel: LoyaltyConsentChannel.WHATSAPP },
      });
    } catch {
      return;
    }
    const command = body.trim().toLowerCase().replace(/[.!«»"]/g, "");
    const active = (await this.prisma.loyaltyMember.findMany({ where: { id: { in: memberIds }, status: LoyaltyMemberStatus.ACTIVE }, select: { id: true } })).map((m) => m.id);
    if (STOP_WORDS.has(command)) {
      await this.setConsent(active, false, null);
      await this.reply(waId, "Вы отписались от уведомлений бонусной программы. Чтобы подписаться снова, ответьте СТАРТ.");
      return;
    }
    if (active.length === 0) {
      await this.reply(waId, "Вы отозвали согласие на участие в бонусной программе. Чтобы вернуться, обратитесь к кассиру.");
      return;
    }
    if (START_WORDS.has(command)) {
      await this.setConsent(active, true, null);
      await this.reply(waId, "Спасибо! Уведомления о баллах будут приходить сюда. Чтобы отписаться, ответьте СТОП.");
      return;
    }
    await this.reply(waId, await this.balanceText(active));
  }

  private async balanceText(memberIds: string[]): Promise<string> {
    const lines: string[] = [];
    const subscribed = await this.reachableIds(memberIds);
    for (const memberId of memberIds) {
      const rows = await this.prisma.loyaltyPointsEntry.findMany({ where: { memberId } });
      const position = pointsPosition(
        rows.map((r) => ({ id: r.id, type: r.type, points: r.points.toNumber(), expiresAt: r.expiresAt, createdAt: r.createdAt })),
        new Date(),
      );
      lines.push(`На счёте: ${pointsFmt.format(position.available)} баллов (1 балл = 1 ₸).`);
      const soon = position.liveLots[0];
      if (soon) lines.push(`${pointsFmt.format(soon.remaining)} из них сгорят ${dateFmt.format(soon.expiresAt)}.`);
    }
    lines.push("");
    lines.push(subscribed.size > 0 ? "Чтобы отписаться от уведомлений, ответьте СТОП." : "Чтобы получать уведомления о баллах, ответьте СТАРТ.");
    return lines.join("\n");
  }

  // Members a WhatsApp id leads to (a merged duplicate leads to its primary).
  private async membersByWaId(waId: string): Promise<string[]> {
    const phone = normalizeKzPhone(`+${waId.replace(/\D/g, "")}`);
    if (!phone) return [];
    const found = await this.prisma.loyaltyMember.findMany({ where: { phone }, select: { id: true } });
    const ids = new Set<string>();
    for (const { id } of found) {
      let current = await this.prisma.loyaltyMember.findUnique({ where: { id }, select: { id: true, mergedIntoId: true } });
      for (let hop = 0; current?.mergedIntoId && hop < MAX_MERGE_HOPS; hop += 1) {
        current = await this.prisma.loyaltyMember.findUnique({ where: { id: current.mergedIntoId }, select: { id: true, mergedIntoId: true } });
      }
      if (current) ids.add(current.id);
    }
    return [...ids];
  }

  // The customer's own decision, recorded only where it changes something.
  private async setConsent(memberIds: string[], granted: boolean, note: string | null): Promise<void> {
    for (const memberId of memberIds) {
      const member = await this.prisma.loyaltyMember.findUnique({ where: { id: memberId }, include: { consents: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } } });
      if (!member || member.status !== LoyaltyMemberStatus.ACTIVE) continue;
      if (consentState(member.consents).marketing.WHATSAPP === granted) continue;
      await recordChannelConsent(this.prisma, {
        organizationId: member.organizationId,
        memberId,
        channel: LoyaltyConsentChannel.WHATSAPP,
        granted,
        source: LoyaltyConsentSource.WHATSAPP,
        recordedByName: CUSTOMER_NAME,
        note,
      });
    }
  }

  // ── templates and status (programme card) ─────────────────────────────────

  private phoneNumberId(): string {
    return WhatsAppService.config().phoneNumberId ?? "";
  }

  // Our templates as Meta sees them; null when Meta could not be asked.
  private async templateStates(force = false): Promise<Map<string, TemplateState> | null> {
    if (!this.transport) return null;
    if (!force && this.templates && Date.now() - this.templates.at < CACHE_MS) return this.templates.byName;
    try {
      const res = await this.transport.request("GET", `${WhatsAppService.config().businessAccountId}/message_templates?fields=name,status,language,rejected_reason&limit=200`);
      const byName = new Map<string, TemplateState>();
      for (const t of res?.data ?? []) {
        if (t?.language !== WHATSAPP_LANGUAGE) continue;
        const reason = t.rejected_reason && t.rejected_reason !== "NONE" ? String(t.rejected_reason) : null;
        byName.set(String(t.name), { status: String(t.status).toUpperCase() as LoyaltyWhatsAppTemplateStatus, rejectedReason: reason });
      }
      this.templates = { at: Date.now(), byName };
      if (this.problem && !this.problem.startsWith("Ключ")) this.problem = null;
      return byName;
    } catch (err) {
      const code = err instanceof WhatsAppApiError ? err.code : null;
      this.problem = describeWhatsAppFailure(code, err instanceof Error ? err.message : String(err));
      this.logger.warn(`WhatsApp templates could not be read: ${this.problem}`);
      return this.templates?.byName ?? null;
    }
  }

  // Sends Meta every template it does not have yet (owner/admin, once).
  async submitTemplates(): Promise<LoyaltyWhatsAppTemplateDto[]> {
    if (!this.transport) throw new BadRequestException("WhatsApp не подключён");
    const existing = await this.templateStates(true);
    if (!existing) throw new BadRequestException(this.problem ?? "Не удалось связаться с Meta");
    const errors: string[] = [];
    for (const t of Object.values(WHATSAPP_TEMPLATES)) {
      if (existing.has(t.name)) continue;
      try {
        await this.transport.request("POST", `${WhatsAppService.config().businessAccountId}/message_templates`, {
          name: t.name,
          language: WHATSAPP_LANGUAGE,
          category: t.category,
          components: [
            { type: "BODY", text: t.text, example: { body_text: [t.example] } },
            { type: "FOOTER", text: FOOTER },
          ],
        });
      } catch (err) {
        errors.push(`${t.purpose}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) throw new BadRequestException(`Meta не приняла шаблоны — ${errors.join("; ")}`);
    return this.templateList(await this.templateStates(true));
  }

  private templateList(states: Map<string, TemplateState> | null): LoyaltyWhatsAppTemplateDto[] {
    return Object.values(WHATSAPP_TEMPLATES).map((t) => {
      const state = states?.get(t.name);
      return {
        name: t.name,
        purpose: t.purpose,
        category: t.category,
        text: `${t.text}\n${FOOTER}`,
        status: states === null ? "UNKNOWN" : (state?.status ?? "MISSING"),
        rejectedReason: state?.rejectedReason ?? null,
      };
    });
  }

  private async readPhoneInfo() {
    if (!this.transport) return null;
    if (this.phoneInfo && Date.now() - this.phoneInfo.at < CACHE_MS) return this.phoneInfo;
    try {
      const res = await this.transport.request("GET", `${this.phoneNumberId()}?fields=display_phone_number,verified_name,quality_rating`);
      this.phoneInfo = {
        at: Date.now(),
        phone: res?.display_phone_number ?? null,
        verifiedName: res?.verified_name ?? null,
        qualityRating: res?.quality_rating ?? null,
      };
      return this.phoneInfo;
    } catch (err) {
      const code = err instanceof WhatsAppApiError ? err.code : null;
      this.problem = describeWhatsAppFailure(code, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async status(organizationId: string, withSecrets: boolean): Promise<LoyaltyWhatsAppStatusDto> {
    const missingSettings = this.transport ? [] : WhatsAppService.missingSettings();
    const info = await this.readPhoneInfo();
    const states = await this.templateStates();
    const counts = await this.prisma.loyaltyMessageLog.groupBy({
      by: ["status"],
      where: { organizationId, channel: LoyaltyConsentChannel.WHATSAPP, status: { not: null }, sentAt: { gte: new Date(Date.now() - 30 * DAY) } },
      _count: { _all: true },
    });
    const last30Days = { SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0 } as Record<LoyaltyMessageStatus, number>;
    for (const c of counts) if (c.status) last30Days[c.status as LoyaltyMessageStatus] = c._count._all;
    const base = process.env.CUSTOMER_BOT_WEBHOOK_BASE_URL || process.env.RENDER_EXTERNAL_URL;
    return {
      configured: this.transport !== null,
      problem: this.transport ? this.problem : null,
      missingSettings,
      phone: info?.phone ?? null,
      verifiedName: info?.verifiedName ?? null,
      qualityRating: info?.qualityRating ?? null,
      webhookUrl: withSecrets && base ? `${base.replace(/\/$/, "")}/api/loyalty/whatsapp/webhook` : null,
      verifyToken: withSecrets && WhatsAppService.config().appSecret ? WhatsAppService.verifyToken() : null,
      reachableMembers: (await this.reachableMemberIds(organizationId)).length,
      templates: this.templateList(this.transport ? states : new Map()),
      last30Days,
    };
  }
}
