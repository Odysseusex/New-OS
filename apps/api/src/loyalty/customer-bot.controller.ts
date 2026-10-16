import { Body, Controller, Get, Headers, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, MinLength } from "class-validator";
import { LOYALTY_ADMIN_ROLES, LOYALTY_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CustomerBotService } from "./customer-bot.service";

export class SendLoyaltyTelegramDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  memberIds!: string[];

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  text!: string;
}

@Controller("loyalty/telegram")
export class CustomerBotController {
  constructor(private bot: CustomerBotService) {}

  // Called by Telegram only. No session: guarded by the secret Telegram echoes
  // back on every delivery (set together with the webhook at boot).
  @Post("webhook")
  async webhook(@Headers("x-telegram-bot-api-secret-token") secret: string | undefined, @Body() update: unknown): Promise<{ ok: true }> {
    if (!this.bot.isEnabled() || secret !== CustomerBotService.webhookSecret()) throw new UnauthorizedException();
    await this.bot.handleUpdate(update as never);
    return { ok: true };
  }

  @Get("status")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...LOYALTY_MANAGE_ROLES)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.bot.status(user.organizationId);
  }

  // A message written by the owner, delivered only to members who consented.
  @Post("send")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...LOYALTY_ADMIN_ROLES)
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendLoyaltyTelegramDto) {
    return this.bot.sendManual(user, dto.memberIds, dto.text);
  }
}
