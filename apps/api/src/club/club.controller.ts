import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ClubAuthGuard, CurrentClubSession } from "./club-auth.guard";
import { ClubService, ClubSession } from "./club.service";
import { ClubLoginStatusRequestDto, StartClubLoginDto, UpdateClubProfileDto } from "./club.dto";

// The customer app (ar-amir.com/app). No staff login here: sign-in is the
// customer's own message (see club-confirm.ts), then a club token.
@Controller("club")
export class ClubController {
  constructor(private club: ClubService) {}

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

  @Post("logout")
  @HttpCode(200)
  @UseGuards(ClubAuthGuard)
  logout(@CurrentClubSession() session: ClubSession) {
    return this.club.logout(session);
  }
}
