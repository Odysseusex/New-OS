import { Injectable } from "@nestjs/common";
import { Prisma, TelegramPendingAction } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;

export type ClaimResult =
  | { status: "claimed"; action: TelegramPendingAction }
  | { status: "already"; action: TelegramPendingAction }
  | { status: "expired" }
  | { status: "not_found" };

// Stages a write action ("Списать 5 кг муки — причина: брак") behind a
// Подтвердить/Отмена card before it's actually executed, so a duplicate
// Telegram callback (double-tap, or Telegram's own retry when a handler is
// slow to answer) can be detected and no-opped instead of calling the
// underlying ArAmir service twice. The only real guarantee comes from
// claim()'s single conditional UPDATE — everything else here is bookkeeping.
@Injectable()
export class TelegramPendingActionService {
  constructor(private prisma: PrismaService) {}

  async create(params: {
    userId: string;
    chatId: string;
    actionType: string;
    payload: Record<string, unknown>;
  }): Promise<TelegramPendingAction> {
    return this.prisma.telegramPendingAction.create({
      data: {
        userId: params.userId,
        chatId: params.chatId,
        actionType: params.actionType,
        payload: params.payload as Prisma.InputJsonValue,
      },
    });
  }

  async claim(id: string): Promise<ClaimResult> {
    const existing = await this.prisma.telegramPendingAction.findUnique({ where: { id } });
    if (!existing) return { status: "not_found" };
    if (existing.status !== "PENDING") return { status: "already", action: existing };

    const cutoff = new Date(Date.now() - PENDING_ACTION_TTL_MS);
    if (existing.createdAt < cutoff) {
      await this.prisma.telegramPendingAction.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      return { status: "expired" };
    }

    // The one place correctness actually lives: only the request that flips
    // this row from PENDING wins — a concurrent duplicate finds count 0 and
    // falls through to "already" below.
    const result = await this.prisma.telegramPendingAction.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "EXECUTING" },
    });
    if (result.count === 0) {
      const latest = await this.prisma.telegramPendingAction.findUnique({ where: { id } });
      return latest ? { status: "already", action: latest } : { status: "not_found" };
    }
    return { status: "claimed", action: existing };
  }

  async markExecuted(id: string, resultId: string | null): Promise<void> {
    await this.prisma.telegramPendingAction.update({
      where: { id },
      data: { status: "EXECUTED", resultId, executedAt: new Date() },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.telegramPendingAction.update({
      where: { id },
      data: { status: "FAILED", executedAt: new Date() },
    });
  }
}
