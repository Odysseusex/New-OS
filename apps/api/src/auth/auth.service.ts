import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { LoginResponseDto, CurrentUserDto, Role, SALE_CREATE_ROLES, TillApprovalAction, TillApprovalDto } from "@bakery-os/shared";
import { findUserByPin, signTillApproval } from "./till-pin";
import { recordAudit } from "../audit/audit";
import { AuthenticatedUser, JwtPayload } from "./auth.types";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException("Неверный email или пароль");
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Неверный email или пароль");
    }

    const payload: JwtPayload = { sub: user.id, organizationId: user.organizationId };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: this.toCurrentUserDto(user),
    };
  }

  // «Сменить кассира» on a till already signed in: the PIN of another employee of the
  // same organization who works at the till, at the same point (or org-wide).
  async pinLogin(actor: AuthenticatedUser, pin: string): Promise<LoginResponseDto> {
    const found = await findUserByPin(this.prisma, actor, pin);
    if (!SALE_CREATE_ROLES.includes(found.role as Role)) throw new ForbiddenException("Этот сотрудник не работает на кассе");
    if (actor.locationId && found.locationId && actor.locationId !== found.locationId) {
      throw new ForbiddenException("Этот сотрудник работает на другой точке");
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: found.id }, include: { organization: true } });
    const accessToken = await this.jwtService.signAsync({ sub: user.id, organizationId: user.organizationId } satisfies JwtPayload);
    return { accessToken, user: this.toCurrentUserDto(user) };
  }

  // A senior cashier's PIN typed on a cashier's till. Removing a line is approved and
  // logged here at once (nothing else is written for it); a discount or a return
  // carries the token to its own request.
  async tillApproval(actor: AuthenticatedUser, pin: string, action: TillApprovalAction, locationId?: string, detail?: string): Promise<TillApprovalDto> {
    const { approvalToken, approver } = await signTillApproval(this.prisma, actor, pin, action, locationId);
    if (action === "LINE_REMOVAL") {
      await this.prisma.$transaction((tx) =>
        recordAudit(tx, {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: "till.lineRemoval",
          entityType: "User",
          entityId: approver.id,
          after: { approvedBy: approver.fullName, cashier: actor.fullName, detail: detail?.slice(0, 300) ?? null, locationId: locationId ?? actor.locationId },
        }),
      );
    }
    return { approvalToken, approverName: approver.fullName };
  }

  async validateUserById(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) return null;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as AuthenticatedUser["role"],
      title: user.title,
      organizationId: user.organizationId,
      regionId: user.regionId,
      locationId: user.locationId,
    };
  }

  private toCurrentUserDto(user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    title: string | null;
    organizationId: string;
    organization: { id: string; name: string; demoParentId: string | null };
    locationId: string | null;
  }): CurrentUserDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role as CurrentUserDto["role"],
      title: user.title,
      organizationId: user.organizationId,
      organization: { id: user.organization.id, name: user.organization.name, isDemo: !!user.organization.demoParentId },
      locationId: user.locationId,
    };
  }
}
