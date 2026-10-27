import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthenticatedUser } from "../../auth/auth.types";
import { assertNotDemo } from "../demo-guard";

// For routes that reach beyond the caller's own organization (the whole-database
// download, the fiscal cash register, the WhatsApp account): refused inside the
// sandbox («Песочница»). Goes after JwtAuthGuard, which puts the user on the request.
@Injectable()
export class NotDemoGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (user) await assertNotDemo(this.prisma, user.organizationId);
    return true;
  }
}
