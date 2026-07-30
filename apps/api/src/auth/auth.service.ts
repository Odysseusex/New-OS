import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { LoginResponseDto, CurrentUserDto } from "@bakery-os/shared";
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
    organization: { id: string; name: string };
    locationId: string | null;
  }): CurrentUserDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role as CurrentUserDto["role"],
      title: user.title,
      organizationId: user.organizationId,
      organization: { id: user.organization.id, name: user.organization.name },
      locationId: user.locationId,
    };
  }
}
