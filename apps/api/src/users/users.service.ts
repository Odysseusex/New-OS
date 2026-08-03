import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { ORG_WIDE_ROLES, Role, UserAccountDto } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateUserAccountDto } from "./dto/create-user-account.dto";
import { UpdateUserAccountDto } from "./dto/update-user-account.dto";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<UserAccountDto[]> {
    const users = await this.prisma.user.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: { location: true },
      orderBy: { fullName: "asc" },
    });
    return users.map(this.toDto);
  }

  async create(actor: AuthenticatedUser, dto: CreateUserAccountDto): Promise<UserAccountDto> {
    this.assertCanAssignRole(actor, dto.role);
    const locationId = ORG_WIDE_ROLES.includes(dto.role) ? null : (dto.locationId ?? null);
    if (locationId) {
      await this.assertLocationExists(actor.organizationId, locationId);
    } else if (!ORG_WIDE_ROLES.includes(dto.role)) {
      throw new BadRequestException("Для этой роли нужно выбрать точку");
    }

    const existing = await this.prisma.user.findFirst({
      where: { organizationId: actor.organizationId, email: dto.email },
    });
    if (existing) {
      throw new ConflictException("Сотрудник с таким email уже есть в организации");
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
        role: dto.role,
        title: dto.title || null,
        locationId,
      },
      include: { location: true },
    });
    return this.toDto(user);
  }

  async update(actor: AuthenticatedUser, userId: string, dto: UpdateUserAccountDto): Promise<UserAccountDto> {
    const target = await this.prisma.user.findFirst({ where: { id: userId, organizationId: actor.organizationId } });
    if (!target) {
      throw new NotFoundException("Сотрудник не найден");
    }
    this.assertCanEditTarget(actor, target.role as Role);
    if (dto.role) {
      this.assertCanAssignRole(actor, dto.role);
    }

    const nextRole = dto.role ?? (target.role as Role);
    let nextLocationId = target.locationId;
    if (ORG_WIDE_ROLES.includes(nextRole)) {
      nextLocationId = null;
    } else if (dto.locationId !== undefined) {
      nextLocationId = dto.locationId;
    }
    if (!ORG_WIDE_ROLES.includes(nextRole)) {
      if (!nextLocationId) {
        throw new BadRequestException("Для этой роли нужно выбрать точку");
      }
      await this.assertLocationExists(actor.organizationId, nextLocationId);
    }

    if (dto.email && dto.email !== target.email) {
      const existing = await this.prisma.user.findFirst({
        where: { organizationId: actor.organizationId, email: dto.email, id: { not: userId } },
      });
      if (existing) {
        throw new ConflictException("Сотрудник с таким email уже есть в организации");
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: dto.fullName ?? undefined,
        email: dto.email ?? undefined,
        role: dto.role ?? undefined,
        title: dto.title !== undefined ? dto.title || null : undefined,
        locationId: nextLocationId,
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
      },
      include: { location: true },
    });
    return this.toDto(updated);
  }

  async archive(actor: AuthenticatedUser, userId: string): Promise<UserAccountDto> {
    return this.setActive(actor, userId, false);
  }

  async restore(actor: AuthenticatedUser, userId: string): Promise<UserAccountDto> {
    return this.setActive(actor, userId, true);
  }

  private async setActive(actor: AuthenticatedUser, userId: string, isActive: boolean): Promise<UserAccountDto> {
    if (userId === actor.id && !isActive) {
      throw new BadRequestException("Нельзя деактивировать собственный аккаунт");
    }
    const target = await this.prisma.user.findFirst({ where: { id: userId, organizationId: actor.organizationId } });
    if (!target) {
      throw new NotFoundException("Сотрудник не найден");
    }
    this.assertCanEditTarget(actor, target.role as Role);

    if (!isActive && target.role === Role.OWNER) {
      const activeOwners = await this.prisma.user.count({
        where: { organizationId: actor.organizationId, role: Role.OWNER, isActive: true },
      });
      if (activeOwners <= 1) {
        throw new BadRequestException("Нельзя деактивировать последнего владельца организации");
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      include: { location: true },
    });
    return this.toDto(updated);
  }

  // Editing (or granting) the Owner role is restricted to actors who are
  // already Owners, so an Admin can't escalate their own or anyone else's
  // access to full ownership of the organization.
  private assertCanAssignRole(actor: AuthenticatedUser, role: Role) {
    if (role === Role.OWNER && actor.role !== Role.OWNER) {
      throw new BadRequestException("Назначить роль «Разработчик» может только разработчик");
    }
  }

  private assertCanEditTarget(actor: AuthenticatedUser, targetRole: Role) {
    if (targetRole === Role.OWNER && actor.role !== Role.OWNER) {
      throw new BadRequestException("Изменять аккаунт владельца может только владелец");
    }
  }

  private async assertLocationExists(organizationId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId } });
    if (!location) {
      throw new BadRequestException("Точка не найдена");
    }
  }

  private toDto = (user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    title: string | null;
    locationId: string | null;
    location: { name: string } | null;
    isActive: boolean;
  }): UserAccountDto => ({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role as Role,
    title: user.title,
    locationId: user.locationId,
    locationName: user.location?.name ?? null,
    isActive: user.isActive,
  });
}
