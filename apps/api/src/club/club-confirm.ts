import { createHmac, randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import {
  CARD_CODE_SKEW_STEPS,
  cardCodeStep,
  LoyaltyConsentChannel,
  LoyaltyConsentPurpose,
  LoyaltyConsentSource,
  LoyaltyMemberStatus,
  truncateCardCode,
} from "@bakery-os/shared";
import { recordAudit } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";

// Plain functions with no service imports, so the WhatsApp service and the
// customer Telegram bot can both call them without a dependency cycle.

const APP_RECORDER = "Клиент (приложение)";
const MAX_MERGE_HOPS = 10;

export type ClubConfirmChannel = "WHATSAPP" | "TELEGRAM";

export type ClubConfirmResult = { matched: false } | { matched: true; ok: boolean; message: string };

const CODE_IN_TEXT = /(?:^|\D)(\d{6})(?:\D|$)/;
const LOOKS_LIKE_LOGIN = /код\s+входа/i;

export function newCardSecret(): string {
  return randomBytes(20).toString("hex");
}

export function cardCodeAt(secret: string, step: number): string {
  return truncateCardCode(new Uint8Array(createHmac("sha256", secret).update(String(step)).digest()));
}

// Is `code` this secret's code for a step near `now`?
export function cardCodeValid(secret: string, code: string, now = Date.now()): boolean {
  const step = cardCodeStep(now);
  for (let d = -CARD_CODE_SKEW_STEPS; d <= CARD_CODE_SKEW_STEPS; d += 1) {
    if (cardCodeAt(secret, step + d) === code) return true;
  }
  return false;
}

// A member record the phone leads to (a merged duplicate leads to its primary).
export async function finalMemberByPhone(db: Prisma.TransactionClient | PrismaService, organizationId: string, phone: string) {
  let member = await db.loyaltyMember.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
  for (let hop = 0; member?.mergedIntoId && hop < MAX_MERGE_HOPS; hop += 1) {
    member = await db.loyaltyMember.findUnique({ where: { id: member.mergedIntoId } });
  }
  return member;
}

// A message reached us from `phone` (verified by WhatsApp itself, or a Telegram
// contact checked against its sender). If it carries the code of a live sign-in
// for that same number, the sign-in is confirmed — and a first-time customer
// is registered with the consent they gave in the app.
export async function confirmClubLogin(
  prisma: PrismaService,
  input: { phone: string | null; text: string; channel: ClubConfirmChannel },
): Promise<ClubConfirmResult> {
  const code = input.text.match(CODE_IN_TEXT)?.[1];
  if (!code) return { matched: false };
  const request = await prisma.clubLoginRequest.findFirst({
    where: { code, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!request) {
    return LOOKS_LIKE_LOGIN.test(input.text)
      ? { matched: true, ok: false, message: "Этот код устарел или уже использован. Начните вход в приложении заново." }
      : { matched: false };
  }
  if (!input.phone || input.phone !== request.phone) {
    return {
      matched: true,
      ok: false,
      message: "Этот код выдан для другого номера. Отправьте его с того номера, который вы указали в приложении.",
    };
  }

  let confirmed: boolean;
  try {
    confirmed = await confirmInTransaction(prisma, request, input.channel);
  } catch (err) {
    // The same message delivered twice at once: the other delivery registered them.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      confirmed = await confirmInTransaction(prisma, request, input.channel);
    } else {
      throw err;
    }
  }

  return {
    matched: true,
    ok: true,
    message: confirmed
      ? "Готово! Вход подтверждён — вернитесь в приложение Ар Амир."
      : "Вход уже подтверждён — вернитесь в приложение Ар Амир.",
  };
}

type LoginRequest = NonNullable<Awaited<ReturnType<PrismaService["clubLoginRequest"]["findFirst"]>>>;

function confirmInTransaction(prisma: PrismaService, request: LoginRequest, channel: ClubConfirmChannel): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    let member = await finalMemberByPhone(tx, request.organizationId, request.phone);
    const now = new Date();
    if (!member) {
      member = await tx.loyaltyMember.create({
        data: { organizationId: request.organizationId, phone: request.phone, name: request.name, cardSecret: newCardSecret() },
      });
      const consent = (purpose: LoyaltyConsentPurpose, channel: LoyaltyConsentChannel | null) => ({
        organizationId: request.organizationId,
        memberId: member!.id,
        purpose,
        channel,
        granted: true,
        source: LoyaltyConsentSource.CUSTOMER_APP,
        recordedByName: APP_RECORDER,
        recordedAt: now,
        note: null,
      });
      await tx.loyaltyConsent.createMany({
        data: [
          consent(LoyaltyConsentPurpose.PERSONAL_DATA, null),
          ...(request.marketing ? [consent(LoyaltyConsentPurpose.MARKETING, LoyaltyConsentChannel.WHATSAPP)] : []),
        ],
      });
      await recordAudit(tx, {
        organizationId: request.organizationId,
        actorId: null,
        action: "loyaltyMember.create",
        entityType: "LoyaltyMember",
        entityId: member.id,
        after: { phone: member.phone, name: member.name, source: LoyaltyConsentSource.CUSTOMER_APP, marketingWhatsApp: request.marketing },
      });
    } else if (member.status === LoyaltyMemberStatus.WITHDRAWN) {
      // They agreed again in the app: the same as agreeing again at the till.
      await tx.loyaltyConsent.create({
        data: {
          organizationId: request.organizationId,
          memberId: member.id,
          purpose: LoyaltyConsentPurpose.PERSONAL_DATA,
          channel: null,
          granted: true,
          source: LoyaltyConsentSource.CUSTOMER_APP,
          recordedByName: APP_RECORDER,
          recordedAt: now,
        },
      });
      member = await tx.loyaltyMember.update({ where: { id: member.id }, data: { status: LoyaltyMemberStatus.ACTIVE } });
      await recordAudit(tx, {
        organizationId: request.organizationId,
        actorId: null,
        action: "loyaltyMember.consent",
        entityType: "LoyaltyMember",
        entityId: member.id,
        before: { status: LoyaltyMemberStatus.WITHDRAWN },
        after: { status: LoyaltyMemberStatus.ACTIVE, source: LoyaltyConsentSource.CUSTOMER_APP },
      });
    }
    if (request.marketing) {
      // Ticked «уведомления в WhatsApp» in the app: recorded unless already so.
      const latest = await tx.loyaltyConsent.findFirst({
        where: { memberId: member.id, purpose: LoyaltyConsentPurpose.MARKETING, channel: LoyaltyConsentChannel.WHATSAPP },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      });
      if (!latest?.granted) {
        await tx.loyaltyConsent.create({
          data: {
            organizationId: request.organizationId,
            memberId: member.id,
            purpose: LoyaltyConsentPurpose.MARKETING,
            channel: LoyaltyConsentChannel.WHATSAPP,
            granted: true,
            source: LoyaltyConsentSource.CUSTOMER_APP,
            recordedByName: APP_RECORDER,
            recordedAt: now,
          },
        });
      }
    }
    if (!member.cardSecret) {
      await tx.loyaltyMember.update({ where: { id: member.id }, data: { cardSecret: newCardSecret() } });
    }
    // Only the first message counts (Meta may deliver it twice).
    const flipped = await tx.clubLoginRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "CONFIRMED", memberId: member.id, channel, confirmedAt: now },
    });
    return flipped.count === 1;
  });
}
