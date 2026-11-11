import { createECDH, createHmac } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import * as webpush from "web-push";
import { LoyaltyMemberStatus } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";

// Notifications of the customer app (ar-amir.com/app): standard Web Push, free
// of charge. A phone that tapped «Включить уведомления» is a subscription row;
// a notice goes to every phone of the member, once per key.
//
// The server's key pair (VAPID) is DERIVED from JWT_SECRET, like the app's other
// secondary keys: nothing to configure, nothing stored, nothing in a backup. If
// JWT_SECRET ever changes the app notices the new public key and re-subscribes.

export interface ClubPushMessage {
  title: string;
  body: string;
  // Where a tap leads (default: the card).
  url?: string;
}

export interface ClubPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// The push service's answer for a phone that is gone (app removed, permission taken back).
const GONE = new Set([404, 410]);
const CONTACT = "https://ar-amir.com";
const b64url = (buf: Buffer) => buf.toString("base64url");

function vapidKeys(): { publicKey: string; privateKey: string } {
  const seed = createHmac("sha256", process.env.JWT_SECRET ?? "dev-secret-change-me").update("club-web-push-vapid").digest();
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(seed);
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(seed) };
}

@Injectable()
export class ClubPushService {
  private readonly logger = new Logger(ClubPushService.name);
  private readonly keys = vapidKeys();
  // Replaced in specs; throws { statusCode } like the library does.
  transport: (target: ClubPushTarget, payload: string) => Promise<void> = async (target, payload) => {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
      vapidDetails: { subject: CONTACT, publicKey: this.keys.publicKey, privateKey: this.keys.privateKey },
      TTL: 3 * 24 * 3600,
    });
  };

  constructor(private prisma: PrismaService) {}

  publicKey(): string {
    return this.keys.publicKey;
  }

  // The phone is the member's from now on (a phone handed to someone else who
  // signs in simply moves with its subscription).
  async subscribe(organizationId: string, memberId: string, target: ClubPushTarget): Promise<{ subscribed: true }> {
    const now = new Date();
    await this.prisma.clubPushSubscription.upsert({
      where: { endpoint: target.endpoint },
      create: { organizationId, memberId, ...target },
      update: { organizationId, memberId, p256dh: target.p256dh, auth: target.auth, lastSeenAt: now },
    });
    return { subscribed: true };
  }

  async unsubscribe(memberId: string, endpoint: string): Promise<{ subscribed: false }> {
    await this.prisma.clubPushSubscription.deleteMany({ where: { memberId, endpoint } });
    return { subscribed: false };
  }

  // Decided BEFORE sending (like WhatsApp): a member with a phone subscribed gets
  // the notice in the app and on no other channel.
  async hasDevices(memberId: string): Promise<boolean> {
    return (await this.prisma.clubPushSubscription.count({ where: { memberId } })) > 0;
  }

  // Never throws. Returns whether at least one phone took it.
  async send(memberId: string, key: string, message: ClubPushMessage): Promise<boolean> {
    try {
      const member = await this.prisma.loyaltyMember.findUnique({ where: { id: memberId }, select: { status: true, organizationId: true } });
      if (!member || member.status !== LoyaltyMemberStatus.ACTIVE) return false;
      const devices = await this.prisma.clubPushSubscription.findMany({ where: { memberId } });
      if (devices.length === 0) return false;
      // Claim the key first: two parallel attempts never both send.
      try {
        await this.prisma.clubPushNotice.create({ data: { organizationId: member.organizationId, memberId, key, title: message.title, body: message.body } });
      } catch {
        return false;
      }
      const payload = JSON.stringify({ title: message.title, body: message.body, tag: key, url: message.url ?? "/app" });
      let delivered = 0;
      for (const d of devices) {
        try {
          await this.transport(d, payload);
          delivered += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status !== undefined && GONE.has(status)) {
            await this.prisma.clubPushSubscription.deleteMany({ where: { id: d.id } });
          } else {
            this.logger.warn(`Push to member ${memberId} not delivered (${status ?? (err instanceof Error ? err.message : "error")})`);
          }
        }
      }
      // Nothing went out: free the key so a later attempt can still send it.
      if (delivered === 0) await this.prisma.clubPushNotice.deleteMany({ where: { memberId, key } });
      return delivered > 0;
    } catch (err) {
      this.logger.error(`Push notice for ${memberId} failed`, err instanceof Error ? err.stack : String(err));
      return false;
    }
  }
}
