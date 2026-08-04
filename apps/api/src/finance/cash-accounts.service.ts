import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CashAccountDto, CashAccountType, CashMovementType } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateCashAccountDto } from "./dto/create-cash-account.dto";
import { UpdateCashAccountDto } from "./dto/update-cash-account.dto";

const ACCOUNT_INCLUDE = { location: true };

@Injectable()
export class CashAccountsService {
  constructor(private prisma: PrismaService) {}

  async findAll(organizationId: string, includeArchived = false): Promise<CashAccountDto[]> {
    const accounts = await this.prisma.cashAccount.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: ACCOUNT_INCLUDE,
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return accounts.map(this.toDto);
  }

  async create(user: AuthenticatedUser, dto: CreateCashAccountDto): Promise<CashAccountDto> {
    if (dto.type === CashAccountType.CASH && !dto.locationId) {
      throw new BadRequestException("Для кассы нужно указать точку");
    }
    if (dto.type === CashAccountType.BANK && dto.locationId) {
      throw new BadRequestException("Банковский счёт не привязывается к точке");
    }
    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, organizationId: user.organizationId },
      });
      if (!location) {
        throw new NotFoundException("Точка не найдена");
      }
    }

    const openingBalance = dto.openingBalance ?? 0;

    const account = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.cashAccount.updateMany({
          where: { organizationId: user.organizationId, type: CashAccountType.BANK, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.cashAccount.create({
        data: {
          organizationId: user.organizationId,
          name: dto.name,
          type: dto.type,
          locationId: dto.locationId,
          isDefault: dto.isDefault ?? false,
          currentBalance: openingBalance,
        },
        include: ACCOUNT_INCLUDE,
      });

      if (openingBalance !== 0) {
        await tx.cashMovement.create({
          data: {
            organizationId: user.organizationId,
            accountId: created.id,
            type: CashMovementType.OPENING_BALANCE,
            amount: openingBalance,
            reason: "Начальный остаток",
            createdById: user.id,
          },
        });
      }

      return created;
    });

    return this.toDto(account);
  }

  async update(organizationId: string, accountId: string, dto: UpdateCashAccountDto): Promise<CashAccountDto> {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) {
      throw new NotFoundException("Счёт не найден");
    }
    const updated = await this.prisma.cashAccount.update({
      where: { id: accountId },
      data: { name: dto.name },
      include: ACCOUNT_INCLUDE,
    });
    return this.toDto(updated);
  }

  async setDefault(user: AuthenticatedUser, accountId: string): Promise<CashAccountDto> {
    const account = await this.prisma.cashAccount.findFirst({
      where: { id: accountId, organizationId: user.organizationId },
    });
    if (!account) {
      throw new NotFoundException("Счёт не найден");
    }
    if (account.type !== CashAccountType.BANK) {
      throw new BadRequestException("Основным можно сделать только банковский счёт");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.cashAccount.updateMany({
        where: { organizationId: user.organizationId, type: CashAccountType.BANK, isDefault: true },
        data: { isDefault: false },
      });
      return tx.cashAccount.update({
        where: { id: accountId },
        data: { isDefault: true },
        include: ACCOUNT_INCLUDE,
      });
    });

    return this.toDto(updated);
  }

  async archive(organizationId: string, accountId: string): Promise<CashAccountDto> {
    return this.setActive(organizationId, accountId, false);
  }

  async restore(organizationId: string, accountId: string): Promise<CashAccountDto> {
    return this.setActive(organizationId, accountId, true);
  }

  private async setActive(organizationId: string, accountId: string, isActive: boolean): Promise<CashAccountDto> {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) {
      throw new NotFoundException("Счёт не найден");
    }
    const updated = await this.prisma.cashAccount.update({
      where: { id: accountId },
      data: { isActive },
      include: ACCOUNT_INCLUDE,
    });
    return this.toDto(updated);
  }

  private toDto = (account: {
    id: string;
    name: string;
    type: string;
    locationId: string | null;
    location: { name: string } | null;
    isDefault: boolean;
    currentBalance: { toNumber: () => number };
    isActive: boolean;
  }): CashAccountDto => ({
    id: account.id,
    name: account.name,
    type: account.type as CashAccountType,
    locationId: account.locationId,
    locationName: account.location?.name ?? null,
    isDefault: account.isDefault,
    currentBalance: account.currentBalance.toNumber(),
    isActive: account.isActive,
  });
}
