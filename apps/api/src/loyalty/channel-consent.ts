import { LoyaltyConsentChannel, LoyaltyConsentPurpose, LoyaltyConsentSource } from "@bakery-os/shared";
import { recordAudit } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { consentState } from "./loyalty.service";

// A marketing consent for one channel given or withdrawn by the customer
// themselves (a bot button, «СТОП» in WhatsApp, blocking the bot). Written like
// any other consent row, with its audit entry, in one transaction.
export async function recordChannelConsent(
  prisma: PrismaService,
  input: {
    organizationId: string;
    memberId: string;
    channel: LoyaltyConsentChannel;
    granted: boolean;
    source: LoyaltyConsentSource;
    recordedByName: string;
    note: string | null;
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const consents = await tx.loyaltyConsent.findMany({ where: { memberId: input.memberId }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });
    const before = consentState(consents);
    await tx.loyaltyConsent.create({
      data: {
        organizationId: input.organizationId,
        memberId: input.memberId,
        purpose: LoyaltyConsentPurpose.MARKETING,
        channel: input.channel,
        granted: input.granted,
        source: input.source,
        recordedByName: input.recordedByName,
        note: input.note,
      },
    });
    await recordAudit(tx, {
      organizationId: input.organizationId,
      actorId: null,
      action: "loyaltyMember.consent",
      entityType: "LoyaltyMember",
      entityId: input.memberId,
      before: { consents: before },
      after: { consents: { ...before, marketing: { ...before.marketing, [input.channel]: input.granted } }, source: input.source },
      reason: input.note,
    });
  });
}
