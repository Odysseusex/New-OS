import { ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { pathAllowedForRole } from "../common/role-scope";
import { AuthenticatedUser } from "./auth.types";

// Every signed-in route passes here, so a role limited to one part of the app
// (ROLE_API_SCOPE) is refused everywhere else in one place.
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: unknown, info: unknown, context: ExecutionContext, status?: unknown): TUser {
    const authenticated = super.handleRequest<TUser>(err, user, info, context, status) as TUser & AuthenticatedUser;
    const request = context.switchToHttp().getRequest<{ path?: string; url?: string }>();
    if (!pathAllowedForRole(authenticated.role, request.path ?? request.url ?? "")) {
      throw new ForbiddenException("Этот раздел недоступен для вашей роли");
    }
    return authenticated;
  }
}
