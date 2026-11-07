import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import { ClubService, ClubSession } from "./club.service";
import { verifyClubToken } from "./club-token";

// The customer app's own sign-in, separate from staff logins: a club token on a
// staff route (or a staff token here) is simply not accepted.
@Injectable()
export class ClubAuthGuard implements CanActivate {
  constructor(private club: ClubService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; club?: ClubSession }>();
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const payload = token ? verifyClubToken(token) : null;
    if (!payload) throw new UnauthorizedException("Войдите заново");
    req.club = await this.club.session(payload.sid);
    return true;
  }
}

export const CurrentClubSession = createParamDecorator((_: unknown, context: ExecutionContext): ClubSession => {
  return context.switchToHttp().getRequest<{ club: ClubSession }>().club;
});
