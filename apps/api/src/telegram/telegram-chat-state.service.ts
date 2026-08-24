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

  // Takes a plain object rather than Prisma.InputJsonValue: wizard state is
  // always a bag of collected answers, and the stricter Prisma type rejects
  // ordinary Record<string, unknown> shapes at every call site.
  async set(
    chatId: string,
    userId: string,
    step: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const json = data as Prisma.InputJsonValue;
    await this.prisma.telegramChatState.upsert({
      where: { chatId },
      create: { chatId, userId, step, data: json },
      update: { step, data: json },
    });
  }

  // Resets the wizard step/data only — deliberately NOT a delete. The row's
  // lastMessageId must survive a finished/cancelled wizard, since the very
  // next interaction (e.g. tapping the main menu) should still edit that
  // same "current screen" message rather than starting a fresh one.
  async clear(chatId: string): Promise<void> {
    await this.prisma.telegramChatState.updateMany({ where: { chatId }, data: { step: null } });
  }

  // Records which message is this chat's current "screen" to edit next
  // time. Upserts because the very first message a chat ever receives has
  // no row yet (nothing has called set() for it).
  async trackMessage(chatId: string, userId: string, messageId: string): Promise<void> {
    await this.prisma.telegramChatState.upsert({
      where: { chatId },
      create: { chatId, userId, lastMessageId: messageId },
      update: { lastMessageId: messageId },
    });
  }
}
