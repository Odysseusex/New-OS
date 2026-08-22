import { Injectable } from "@nestjs/common";
import { randomBytes, createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";

const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;
// Unambiguous uppercase alphabet — no 0/O or 1/I — since the code may be
// typed by hand into the bot instead of followed as a deep link.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// Linking is always initiated from an authenticated web session (see
// telegram.controller.ts's link-token endpoint, gated by the normal
// JwtAuthGuard) and only ever consumed by the bot reading a /start payload —
// the bot itself never collects a password or issues its own login.
@Injectable()
export class TelegramLinkService {
  constructor(private prisma: PrismaService) {}

  async createToken(user: AuthenticatedUser): Promise<{ code: string; expiresAt: Date }> {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
    await this.prisma.telegramLinkToken.create({
      data: { userId: user.id, codeHash: hashCode(code), expiresAt },
    });
    return { code, expiresAt };
  }

  // A plain (non-discriminated-union) result shape deliberately — this
  // project builds with strictNullChecks off, which weakens TS's ability to
  // narrow a `{ok:true;...} | {ok:false;...}` union via `if (!result.ok)`,
  // so callers check `result.ok` and read `userId`/`reason` directly rather
  // than relying on narrowing.
  async consumeToken(
    code: string,
    chatId: string,
  ): Promise<{ ok: boolean; userId?: string; reason?: "invalid" | "expired" }> {
    const codeHash = hashCode(code.trim().toUpperCase());
    const token = await this.prisma.telegramLinkToken.findUnique({ where: { codeHash } });

    if (!token || token.consumedAt) {
      return { ok: false, reason: "invalid" };
    }
    if (token.expiresAt < new Date()) {
      return { ok: false, reason: "expired" };
    }

    await this.prisma.$transaction([
      // A Telegram chat is one person — if this chatId was previously linked
      // to a different ArAmir account, that link is superseded, not doubled.
      this.prisma.user.updateMany({
        where: { telegramId: chatId, id: { not: token.userId } },
        data: { telegramId: null },
      }),
      this.prisma.user.update({ where: { id: token.userId }, data: { telegramId: chatId } }),
      this.prisma.telegramLinkToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } }),
    ]);

    return { ok: true, userId: token.userId };
  }

  async isLinked(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
    return !!user?.telegramId;
  }

  async unlink(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { telegramId: null } }),
      this.prisma.telegramChatState.deleteMany({ where: { userId } }),
    ]);
  }
}
