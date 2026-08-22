import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";

// The bot's only notion of "who is this". Every incoming update is resolved
// through here to the exact same AuthenticatedUser shape JwtAuthGuard
// produces for the web — role/location/organization all come from this one
// User row, so a Telegram user can never end up with different effective
// permissions than they have on the web.
@Injectable()
export class TelegramAuthResolver {
  constructor(private prisma: PrismaService) {}

  async resolve(chatId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { telegramId: chatId } });
    if (!user || !user.isActive) return null;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as AuthenticatedUser["role"],
      title: user.title,
      organizationId: user.organizationId,
      regionId: user.regionId,
      locationId: user.locationId,
    };
  }
}
