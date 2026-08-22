import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationType } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { TelegramBotService } from "./telegram-bot.service";
import { escapeHtml } from "./telegram-format";

// Pushes low-stock alerts to Telegram for anyone who's linked their
// account. Reuses NotificationsService.getNotifications — the exact same
// live computation the web Notifications page shows — filtered to
// LOW_STOCK, so there is no second "is this low" calculation anywhere.
// TelegramNotificationLog is the push-specific de-dup layer, mirroring
// NotificationDismissal's own {prefix}:{entityId}:{date} key convention: a
// key already logged today isn't re-sent, but a still-true condition sends
// again once the date rolls over.
@Injectable()
export class TelegramNotificationsCron {
  private readonly logger = new Logger(TelegramNotificationsCron.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private botService: TelegramBotService,
  ) {}

  @Cron("0 */4 * * *")
  async pushLowStockAlerts(): Promise<void> {
    if (!this.botService.isEnabled()) return;

    const users = await this.prisma.user.findMany({
      where: { telegramId: { not: null }, isActive: true },
    });

    for (const user of users) {
      try {
        await this.pushForUser(user);
      } catch (err) {
        this.logger.error(
          `Failed to push notifications to user ${user.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async pushForUser(userRow: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    title: string | null;
    organizationId: string;
    regionId: string | null;
    locationId: string | null;
    telegramId: string | null;
  }): Promise<void> {
    const authUser: AuthenticatedUser = {
      id: userRow.id,
      email: userRow.email,
      fullName: userRow.fullName,
      role: userRow.role as AuthenticatedUser["role"],
      title: userRow.title,
      organizationId: userRow.organizationId,
      regionId: userRow.regionId,
      locationId: userRow.locationId,
    };

    const notifications = (await this.notificationsService.getNotifications(authUser)).filter(
      (n) => n.type === NotificationType.LOW_STOCK,
    );
    if (notifications.length === 0) return;

    const already = await this.prisma.telegramNotificationLog.findMany({
      where: { userId: userRow.id, key: { in: notifications.map((n) => n.key) } },
    });
    const alreadySent = new Set(already.map((a) => a.key));
    const fresh = notifications.filter((n) => !alreadySent.has(n.key));
    if (fresh.length === 0) return;

    for (const n of fresh) {
      await this.botService.sendMessage(userRow.telegramId!, `⚠️ <b>${escapeHtml(n.title)}</b>\n${escapeHtml(n.message)}`);
    }

    await this.prisma.telegramNotificationLog.createMany({
      data: fresh.map((n) => ({ userId: userRow.id, key: n.key })),
      skipDuplicates: true,
    });
  }
}
