import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CashAccountDto,
  CashAccountType,
  CashMovementType,
  LocationNonCashAccountDto,
  PartnerDebtDto,
  partnerShortName,
  SYSTEM_ACCOUNT_DEFS,
  SystemAccountKey,
} from "@bakery-os/shared";
import { Prisma } from "@prisma/client";
import { round2 } from "../common/money";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateCashAccountDto } from "./dto/create-cash-account.dto";
import { UpdateCashAccountDto } from "./dto/update-cash-account.dto";
import { auditFields, recordAudit } from "../audit/audit";

// currentBalance is deliberately left out: it only ever moves through the
// cash ledger, which records every change on its own.
const CASH_ACCOUNT_AUDIT_FIELDS = ["name", "type", "locationId", "isDefault", "isActive"] as const;

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
    if (dto.type === CashAccountType.PERSONAL) {
      // A participant's own pocket: not a place of the business, never the default, and what is
      // already owed is entered with «Корректировка остатка», not as money the business holds.
      if (dto.locationId) throw new BadRequestException("Личный счёт участника не привязывается к точке");
      if (dto.isDefault) throw new BadRequestException("Личный счёт участника не может быть основным");
      if (dto.openingBalance) throw new BadRequestException("У личного счёта участника нет начального остатка: долг вносится корректировкой остатка");
    }
    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, organizationId: user.organizationId },
      });
      if (!location) {
        throw new NotFoundException("Точка не найдена");
      }
    }

    // Only "Запуск финансового учёта" may seed a starting balance out of
    // nowhere — a real account opened after go-live always got its first
    // money from somewhere real (another account, a deposit), so it starts
    // at zero and is funded the ordinary way. This also keeps "sum of every
    // OPENING_BALANCE movement" a stable, permanent stand-in for "cash at
    // go-live" forever, with no separate frozen field needed for it.
    if (dto.openingBalance) {
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
      if (org.financeInitializedAt) {
        throw new BadRequestException(
          "Начальный остаток можно указать только при запуске финансового учёта. Пополните новый счёт обычным поступлением или переводом.",
        );
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
      if (dto.type === CashAccountType.PERSONAL) await ensurePartnerLedgerAccount(tx, user.organizationId);

      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "cashAccount.create",
        entityType: "CashAccount",
        entityId: created.id,
        after: { ...auditFields(created, CASH_ACCOUNT_AUDIT_FIELDS), openingBalance },
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

  async update(
    organizationId: string,
    accountId: string,
    dto: UpdateCashAccountDto,
    actorId: string | null,
  ): Promise<CashAccountDto> {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) {
      throw new NotFoundException("Счёт не найден");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.cashAccount.update({
        where: { id: accountId },
        data: { name: dto.name },
        include: ACCOUNT_INCLUDE,
      });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: "cashAccount.update",
        entityType: "CashAccount",
        entityId: accountId,
        before: auditFields(account, CASH_ACCOUNT_AUDIT_FIELDS),
        after: auditFields(saved, CASH_ACCOUNT_AUDIT_FIELDS),
      });
      return saved;
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
      const saved = await tx.cashAccount.update({
        where: { id: accountId },
        data: { isDefault: true },
        include: ACCOUNT_INCLUDE,
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "cashAccount.setDefault",
        entityType: "CashAccount",
        entityId: accountId,
        before: { isDefault: account.isDefault },
        after: { isDefault: true },
      });
      return saved;
    });

    return this.toDto(updated);
  }

  async nonCashByLocation(organizationId: string): Promise<LocationNonCashAccountDto[]> {
    const locations = await this.prisma.location.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, nonCashAccountId: true },
      orderBy: { name: "asc" },
    });
    return locations.map((l) => ({ locationId: l.id, locationName: l.name, accountId: l.nonCashAccountId }));
  }

  // Where a point's card / Kaspi / transfer takings land from now on. Sales
  // already recorded keep the account they landed in.
  async setNonCashAccount(user: AuthenticatedUser, locationId: string, accountId: string | null): Promise<LocationNonCashAccountDto[]> {
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId: user.organizationId } });
    if (!location) throw new NotFoundException("Точка не найдена");
    if (accountId) {
      const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId: user.organizationId } });
      if (!account || !account.isActive) throw new BadRequestException("Счёт не найден или заархивирован");
      if (account.type !== CashAccountType.BANK) throw new BadRequestException("Для оплат картой выберите банковский счёт");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.location.update({ where: { id: locationId }, data: { nonCashAccountId: accountId } });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "cashAccount.locationNonCash",
        entityType: "Location",
        entityId: locationId,
        before: { nonCashAccountId: location.nonCashAccountId },
        after: { nonCashAccountId: accountId },
      });
    });
    return this.nonCashByLocation(user.organizationId);
  }

  async archive(organizationId: string, accountId: string, actorId: string | null): Promise<CashAccountDto> {
    return this.setActive(organizationId, accountId, false, actorId);
  }

  async restore(organizationId: string, accountId: string, actorId: string | null): Promise<CashAccountDto> {
    return this.setActive(organizationId, accountId, true, actorId);
  }

  private async setActive(
    organizationId: string,
    accountId: string,
    isActive: boolean,
    actorId: string | null,
  ): Promise<CashAccountDto> {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) {
      throw new NotFoundException("Счёт не найден");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.cashAccount.update({
        where: { id: accountId },
        data: { isActive },
        include: ACCOUNT_INCLUDE,
      });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: isActive ? "cashAccount.restore" : "cashAccount.archive",
        entityType: "CashAccount",
        entityId: accountId,
        before: { isActive: account.isActive },
        after: { isActive },
      });
      return saved;
    });
    return this.toDto(updated);
  }

  // What the business owes each participant with a personal account (active ones).
  async partnerDebts(organizationId: string): Promise<PartnerDebtDto[]> {
    const accounts = await this.prisma.cashAccount.findMany({
      where: { organizationId, type: CashAccountType.PERSONAL, isActive: true },
      select: { id: true, name: true, currentBalance: true },
      orderBy: { name: "asc" },
    });
    return accounts.map((a) => ({ accountId: a.id, name: partnerShortName(a.name), owed: round2(-a.currentBalance.toNumber()) }));
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

// An organization whose chart of accounts already exists gets the account the personal accounts post
// to, so the first payment out of a participant's pocket is journalised like any other. An
// organization that has not created its system accounts yet gets it with the rest, on request.
async function ensurePartnerLedgerAccount(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  const existing = await tx.ledgerAccount.findMany({ where: { organizationId }, select: { code: true, systemAccountKey: true } });
  const key = SystemAccountKey.PARTNER_PAYABLES;
  if (!existing.some((a) => a.systemAccountKey) || existing.some((a) => a.systemAccountKey === key)) return;
  const codes = new Set(existing.map((a) => a.code));
  let code: string = key;
  for (let n = 2; codes.has(code); n += 1) code = `${key}_${n}`;
  const def = SYSTEM_ACCOUNT_DEFS[key];
  await tx.ledgerAccount.create({ data: { organizationId, code, name: def.name, type: def.type, normalBalance: def.normalBalance, systemAccountKey: key } });
}
