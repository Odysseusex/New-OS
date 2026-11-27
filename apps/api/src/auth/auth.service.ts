import { createHash } from "crypto";
import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { BAKER_PHONE_ROLES, LoginResponseDto, CurrentUserDto, Role, SALE_CREATE_ROLES, TillApprovalAction, TillApprovalDto } from "@bakery-os/shared";
import { findUserByPin, signTillApproval } from "./till-pin";
import { recordAudit } from "../audit/audit";
import { AuthenticatedUser, JwtPayload } from "./auth.types";
import { assertLoginAllowed, noteLoginFailure } from "./login-throttle";

// Compared when the email is unknown, so an unknown email answers as slowly as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("no-such-user", 10);

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string, ip = ""): Promise<LoginResponseDto> {
    assertLoginAllowed(email, ip);
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      include: { organization: true },
    });

    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches) {
      noteLoginFailure(email, ip);
      throw new UnauthorizedException("Неверный email или пароль");
    }
    // «Помощник» is not a person at a screen: it works only with the key the owner issued.
    if (user.role === Role.ASSISTANT) {
      throw new ForbiddenException("«Помощник» входит только по ключу — выпустите его в Настройках");
    }

    const accessToken = await this.signLogin(user);

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
    if (found.sharedTill) throw new ForbiddenException("Это общий вход точки — введите PIN кассира");
    if (actor.locationId && found.locationId && actor.locationId !== found.locationId) {
      throw new ForbiddenException("Этот сотрудник работает на другой точке");
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: found.id }, include: { organization: true } });
    const accessToken = await this.signLogin(user);
    return { accessToken, user: this.toCurrentUserDto(user) };
  }

  // ── A baker's own phone (/baker) ──
  // The phone is connected ONCE with the baker's email and password and keeps a year-long device
  // key; after that the screen opens with a PIN alone. The key is signed with its own secret, so it
  // is never accepted as a login, and it dies when that account's password changes or the account
  // is switched off.
  private bakerDeviceJwt() {
    return new JwtService({ secret: `${process.env.JWT_SECRET ?? "dev-secret-change-me"}:baker-device` });
  }

  private signLogin(user: { id: string; organizationId: string; passwordHash: string; role?: string }): Promise<string> {
    const payload = { sub: user.id, organizationId: user.organizationId, pv: this.passwordStamp(user.passwordHash) } satisfies JwtPayload;
    // The cashiers' phone count: the phone stays signed in for a month (the login opens one blind screen
    // and nothing else; changing its password ends every phone's session at once).
    return user.role === Role.SHELF_COUNTER ? this.jwtService.signAsync(payload, { expiresIn: "30d" }) : this.jwtService.signAsync(payload);
  }

  private passwordStamp(passwordHash: string): string {
    return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
  }

  async bakerDevice(actor: AuthenticatedUser): Promise<{ deviceToken: string }> {
    if (!BAKER_PHONE_ROLES.includes(actor.role)) throw new ForbiddenException("Телефон подключается только для пекаря");
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { passwordHash: true } });
    const deviceToken = await this.bakerDeviceJwt().signAsync(
      { typ: "baker-device", sub: actor.id, org: actor.organizationId, pv: this.passwordStamp(user.passwordHash) },
      { expiresIn: "365d" },
    );
    return { deviceToken };
  }

  async bakerPinLogin(deviceToken: string, pin: string): Promise<LoginResponseDto> {
    const again = new UnauthorizedException("Телефон нужно подключить заново");
    let payload: { typ?: string; sub?: string; org?: string; pv?: string };
    try {
      payload = await this.bakerDeviceJwt().verifyAsync(deviceToken);
    } catch {
      throw again;
    }
    if (payload.typ !== "baker-device" || !payload.sub || !payload.org) throw again;
    const device = await this.prisma.user.findFirst({ where: { id: payload.sub, organizationId: payload.org, isActive: true } });
    if (!device || !BAKER_PHONE_ROLES.includes(device.role as Role) || this.passwordStamp(device.passwordHash) !== payload.pv) throw again;
    const actor: AuthenticatedUser = {
      id: device.id,
      email: device.email,
      fullName: device.fullName,
      role: device.role as Role,
      title: device.title,
      organizationId: device.organizationId,
      regionId: device.regionId,
      locationId: device.locationId,
    };
    // Wrong PINs are counted per phone (findUserByPin locks it for 5 minutes after 5 misses).
    const found = await findUserByPin(this.prisma, actor, pin);
    if (!BAKER_PHONE_ROLES.includes(found.role as Role)) throw new ForbiddenException("Этот PIN не у пекаря");
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: found.id }, include: { organization: true } });
    const accessToken = await this.signLogin(user);
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

  async validateUserById(userId: string, assistantKeyId?: string, passwordStamp?: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) return null;
    // Issued under a password that has since been changed. (Tokens from before this check carry no
    // stamp and simply run out within their 8 hours.)
    if (passwordStamp !== undefined && passwordStamp !== this.passwordStamp(user.passwordHash)) return null;
    // «Помощник» is let in by its current key alone; that key lets in nobody else.
    const isAssistant = user.role === Role.ASSISTANT;
    if (isAssistant ? !assistantKeyId || assistantKeyId !== user.assistantKeyId : assistantKeyId !== undefined) return null;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as AuthenticatedUser["role"],
      title: user.title,
      organizationId: user.organizationId,
      regionId: user.regionId,
      locationId: user.locationId,
      sharedTill: user.sharedTill,
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
    sharedTill: boolean;
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
      sharedTill: user.sharedTill,
    };
  }
}
