import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ClubAuthGuard, CurrentClubSession } from "./club-auth.guard";
import { ClubService, ClubSession } from "./club.service";
import { BadRequestException } from "@nestjs/common";
import { ClubPushService } from "../loyalty/club-push.service";
import { ClubChatService } from "../loyalty/club-chat.service";
import { ClubChatSendDto, ClubLoginStatusRequestDto, ClubPushSubscribeDto, ClubPushUnsubscribeDto, StartClubLoginDto, UpdateClubProfileDto } from "./club.dto";

// Chrome/Android (FCM), Safari/iOS (Apple), Firefox (Mozilla), Edge (Windows).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export function isPushServiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

// The customer app (ar-amir.com/app). No staff login here: sign-in is the
// customer's own message (see club-confirm.ts), then a club token.
@Controller("club")
export class ClubController {
  constructor(
    private club: ClubService,
    private push: ClubPushService,
    private chat: ClubChatService,
  ) {}

  @Get("info")
  info() {
    return this.club.info();
  }

  @Post("login")
  startLogin(@Body() dto: StartClubLoginDto) {
    return this.club.startLogin(dto);
  }

  @Post("login/:id/status")
  @HttpCode(200)
  loginStatus(@Param("id") id: string, @Body() dto: ClubLoginStatusRequestDto) {
    return this.club.loginStatus(id, dto.secret);
  }

  @Get("me")
  @UseGuards(ClubAuthGuard)
  me(@CurrentClubSession() session: ClubSession) {
    return this.club.profile(session);
  }

  @Patch("me")
  @UseGuards(ClubAuthGuard)
  rename(@CurrentClubSession() session: ClubSession, @Body() dto: UpdateClubProfileDto) {
    return this.club.rename(session, dto.name);
  }

  // Notifications: the key the phone subscribes with, then the phone itself.
  @Get("push/key")
  pushKey() {
    return { publicKey: this.push.publicKey() };
  }

  @Post("push/subscribe")
  @HttpCode(200)
  @UseGuards(ClubAuthGuard)
  pushSubscribe(@CurrentClubSession() session: ClubSession, @Body() dto: ClubPushSubscribeDto) {
    // Only the browsers' own push services: the server will be sending requests to this address.
    if (!isPushServiceUrl(dto.endpoint)) throw new BadRequestException("Уведомления в этом браузере не поддерживаются");
    return this.push.subscribe(session.organizationId, session.memberId, { endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth });
  }

  @Post("push/unsubscribe")
  @HttpCode(200)
  @UseGuards(ClubAuthGuard)
  pushUnsubscribe(@CurrentClubSession() session: ClubSession, @Body() dto: ClubPushUnsubscribeDto) {
    return this.push.unsubscribe(session.memberId, dto.endpoint);
  }

  // The chat with the bakery. Reading the thread marks the bakery's messages read.
  @Get("chat")
  @UseGuards(ClubAuthGuard)
  chatThread(@CurrentClubSession() session: ClubSession) {
    return this.chat.threadForMember(session.memberId);
  }

  @Post("chat")
  @UseGuards(ClubAuthGuard)
  chatSend(@CurrentClubSession() session: ClubSession, @Body() dto: ClubChatSendDto) {
    return this.chat.sendFromMember(session.organizationId, session.memberId, dto.text);
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(ClubAuthGuard)
  logout(@CurrentClubSession() session: ClubSession) {
    return this.club.logout(session);
  }
}
