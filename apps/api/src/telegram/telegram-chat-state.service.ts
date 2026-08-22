import { Injectable } from "@nestjs/common";
import { Prisma, TelegramChatState } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// Tracks which step of a multi-step reply flow (e.g. Списание: товар ->
// количество -> причина -> подтверждение) a chat is currently in, plus the
// answers collected so far. Pure UI-wizard bookkeeping, not a business
// entity — one row per chat, cleared once the flow finishes or is cancelled.
@Injectable()
export class TelegramChatStateService {
  constructor(private prisma: PrismaService) {}

  async get(chatId: string): Promise<TelegramChatState | null> {
    return this.prisma.telegramChatState.findUnique({ where: { chatId } });
  }

  async set(
    chatId: string,
    userId: string,
    step: string,
    data: Prisma.InputJsonValue = {},
  ): Promise<void> {
    await this.prisma.telegramChatState.upsert({
      where: { chatId },
      create: { chatId, userId, step, data },
      update: { step, data },
    });
  }

  async clear(chatId: string): Promise<void> {
    await this.prisma.telegramChatState.deleteMany({ where: { chatId } });
  }
}
