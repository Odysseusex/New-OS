import { Body, Controller, Get, Headers, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { TelegramLinkTokenDto, TelegramStatusDto } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { TelegramLinkService } from "./telegram-link.service";
import { TelegramBotService } from "./telegram-bot.service";

@Controller("telegram")
export class TelegramController {
  constructor(
    private linkService: TelegramLinkService,
    private botService: TelegramBotService,
  ) {}

  // Self-service linking — same trust boundary as any other authenticated
  // action (JwtAuthGuard), no separate role gate: any logged-in user may
  // link their own Telegram account, since it never grants more than that
  // user's own web permissions.
  @UseGuards(JwtAuthGuard)
  @Post("link-token")
  async createLinkToken(@CurrentUser() user: AuthenticatedUser): Promise<TelegramLinkTokenDto> {
    const { code, expiresAt } = await this.linkService.createToken(user);
    return { code, expiresAt: expiresAt.toISOString(), botUsername: process.env.TELEGRAM_BOT_USERNAME || null };
  }

  @UseGuards(JwtAuthGuard)
  @Get("status")
  async status(@CurrentUser() user: AuthenticatedUser): Promise<TelegramStatusDto> {
    return { linked: await this.linkService.isLinked(user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Post("unlink")
  async unlink(@CurrentUser() user: AuthenticatedUser): Promise<{ unlinked: true }> {
    await this.linkService.unlink(user.id);
    return { unlinked: true };
  }

  // Called by Telegram's servers only — no JwtAuthGuard (there is no ArAmir
  // user session at this point, that's resolved per-update from the chat id
  // inside TelegramBotService). Guarded instead by the secret_token Telegram
  // echoes back on every webhook delivery when setWebhook registers one.
  @Post("webhook")
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") secretToken: string | undefined,
    @Body() update: unknown,
  ): Promise<{ ok: true }> {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected && secretToken !== expected) {
      throw new UnauthorizedException();
    }
    await this.botService.handleUpdate(update as never);
    return { ok: true };
  }
}
