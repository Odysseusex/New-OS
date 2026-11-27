import { Injectable, Logger } from "@nestjs/common";
import * as webpush from "web-push";
import { StaffPushSubscribeRequestDto } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { vapidKeys } from "../loyalty/club-push.service";

// Notifications on staff phones (the bakers' screen /baker): the same free Web Push as the customer app,
// with the same derived key pair. A phone follows whoever last signed in on it.

export interface StaffPushMessage {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

// The browsers' own push services only: the server sends requests to whatever address is stored here.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const GONE = new Set([404, 410]);

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

@Injectable()
export class StaffPushService {
  private readonly logger = new Logger(StaffPushService.name);
  private readonly keys = vapidKeys();
  // Replaced in specs.
  transport: (target: { endpoint: string; p256dh: string; auth: string }, payload: string) => Promise<void> = async (target, payload) => {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
      vapidDetails: { subject: "https://ar-amir.com", publicKey: this.keys.publicKey, privateKey: this.keys.privateKey },
      TTL: 6 * 3600,
    });
  };

  constructor(private prisma: PrismaService) {}

  publicKey(): { publicKey: string } {
    return { publicKey: this.keys.publicKey };
  }

  async subscribe(organizationId: string, userId: string, dto: StaffPushSubscribeRequestDto): Promise<{ subscribed: true }> {
    await this.prisma.staffPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { organizationId, userId, endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth },
      update: { organizationId, userId, p256dh: dto.p256dh, auth: dto.auth, lastSeenAt: new Date() },
    });
    return { subscribed: true };
  }

  async unsubscribe(userId: string, endpoint: string): Promise<{ subscribed: false }> {
    await this.prisma.staffPushSubscription.deleteMany({ where: { userId, endpoint } });
    return { subscribed: false };
  }

  // Never throws; returns how many phones took it.
  async send(organizationId: string, userIds: string[], message: StaffPushMessage): Promise<number> {
    if (userIds.length === 0) return 0;
    try {
      const active = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds }, isActive: true }, select: { id: true } });
      const devices = await this.prisma.staffPushSubscription.findMany({ where: { organizationId, userId: { in: active.map((u) => u.id) } } });
      const payload = JSON.stringify({ title: message.title, body: message.body, tag: message.tag, url: message.url ?? "/baker" });
      let delivered = 0;
      for (const d of devices) {
        try {
          await this.transport(d, payload);
          delivered += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status !== undefined && GONE.has(status)) await this.prisma.staffPushSubscription.deleteMany({ where: { id: d.id } });
          else this.logger.warn(`Staff push not delivered (${status ?? (err instanceof Error ? err.message : "error")})`);
        }
      }
      return delivered;
    } catch (err) {
      this.logger.warn(`Staff push failed: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }
}
