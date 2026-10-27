import { Body, Controller, ForbiddenException, Get, Header, Headers, HttpCode, Post, Query, RawBodyRequest, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { LOYALTY_ADMIN_ROLES, LOYALTY_MANAGE_ROLES, Role } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { NotDemoGuard } from "../common/guards/not-demo.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { WhatsAppService } from "./whatsapp.service";

@Controller("loyalty/whatsapp")
export class WhatsAppController {
  constructor(private whatsapp: WhatsAppService) {}

  // Meta's handshake when the webhook is saved in its developer console.
  @Get("webhook")
  @Header("Content-Type", "text/plain")
  verify(@Query("hub.mode") mode?: string, @Query("hub.verify_token") token?: string, @Query("hub.challenge") challenge?: string): string {
    const answer = this.whatsapp.verifySubscription(mode, token, challenge);
    if (answer === null) throw new ForbiddenException();
    return answer;
  }

  // Called by Meta only: no session, the signature over the raw body is the proof.
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers("x-hub-signature-256") signature: string | undefined, @Body() payload: unknown): Promise<{ ok: true }> {
    if (!WhatsAppService.checkSignature(req.rawBody, signature)) throw new UnauthorizedException();
    await this.whatsapp.handleWebhook(payload);
    return { ok: true };
  }

  // The WhatsApp account is the real business's: never from inside the sandbox.
  @Get("status")
  @UseGuards(JwtAuthGuard, RolesGuard, NotDemoGuard)
  @Roles(...LOYALTY_MANAGE_ROLES)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.whatsapp.status(user.organizationId, (LOYALTY_ADMIN_ROLES as readonly Role[]).includes(user.role as Role));
  }

  @Post("templates")
  @UseGuards(JwtAuthGuard, RolesGuard, NotDemoGuard)
  @Roles(...LOYALTY_ADMIN_ROLES)
  submitTemplates() {
    return this.whatsapp.submitTemplates();
  }
}
