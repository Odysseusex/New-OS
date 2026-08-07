import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CASH_MOVEMENT_INFLOW_TYPES, CashMovementDto, CashMovementType } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashDepositDto } from "./dto/cash-deposit.dto";
import { CashWithdrawalDto } from "./dto/cash-withdrawal.dto";
import { CashTransferDto } from "./dto/cash-transfer.dto";
import { CashAdjustmentDto } from "./dto/cash-adjustment.dto";

const MOVEMENT_INCLUDE = {
  account: true,
  categoryRef: true,
  customer: true,
  supplier: true,
  createdBy: true,
};

type MovementWithIncludes = Prisma.CashMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;

export interface RecordMovementParams {
  organizationId: string;
  accountId: string;
  type: CashMovementType;
  // Positive magnitude for every type except ADJUSTMENT, which is a signed
  // delta — see CashMovement's schema comment.
  amount: number;
  reason?: string;
  categoryId?: string;
  customerId?: string;
  supplierId?: string;
  saleId?: string;
  expenseId?: string;
  invoiceId?: string;
  transferGroupId?: string;
  correctsMovementId?: string;
  createdById: string;
}

// The single append-only ledger — the financial counterpart of
// InventoryService. `recordMovement` is the one place that ever writes a
// CashMovement or changes a CashAccount's currentBalance, so every other
// module (Sales, Expenses, Invoices) calls into this rather than touching
// either table directly. Accepts a transaction client so callers that
// already run inside their own $transaction (e.g. SalesService.create) can
// include the cash movement in the same atomic commit.
@Injectable()
export class CashMovementsService {
  constructor(private prisma: PrismaService) {}

  async recordMovement(
    tx: Prisma.TransactionClient | PrismaService,
    params: RecordMovementParams,
  ): Promise<MovementWithIncludes> {
    const isAdjustment = params.type === CashMovementType.ADJUSTMENT;
    const delta = isAdjustment
      ? params.amount
      : CASH_MOVEMENT_INFLOW_TYPES.includes(params.type)
        ? params.amount
        : -params.amount;

    const movement = await tx.cashMovement.create({
      data: {
        organizationId: params.organizationId,
        accountId: params.accountId,
        type: params.type,
        amount: params.amount,
        reason: params.reason,
        categoryId: params.categoryId,
        customerId: params.customerId,
        supplierId: params.supplierId,
        saleId: params.saleId,
        expenseId: params.expenseId,
        invoiceId: params.invoiceId,
        transferGroupId: params.transferGroupId,
        correctsMovementId: params.correctsMovementId,
        createdById: params.createdById,
      },
      include: MOVEMENT_INCLUDE,
    });

    await tx.cashAccount.update({
      where: { id: params.accountId },
      data: { currentBalance: { increment: delta } },
    });

    return movement;
  }

  async findAll(
    organizationId: string,
    accountId?: string,
    limit = 100,
    saleId?: string,
  ): Promise<CashMovementDto[]> {
    const movements = await this.prisma.cashMovement.findMany({
      where: { organizationId, ...(accountId ? { accountId } : {}), ...(saleId ? { saleId } : {}) },
      include: MOVEMENT_INCLUDE,
      orderBy: { occurredAt: "desc" },
      take: limit,
    });
    return movements.map(this.toDto);
  }

  async deposit(user: AuthenticatedUser, dto: CashDepositDto): Promise<CashMovementDto> {
    await this.assertAccount(user.organizationId, dto.accountId);
    const movement = await this.recordMovement(this.prisma, {
      organizationId: user.organizationId,
      accountId: dto.accountId,
      type: CashMovementType.CASH_DEPOSIT,
      amount: dto.amount,
      reason: dto.reason,
      createdById: user.id,
    });
    return this.toDto(movement);
  }

  async withdraw(user: AuthenticatedUser, dto: CashWithdrawalDto): Promise<CashMovementDto> {
    const account = await this.assertAccount(user.organizationId, dto.accountId);
    if (account.currentBalance.toNumber() < dto.amount) {
      throw new BadRequestException("Недостаточно денег на счёте для снятия");
    }
    const movement = await this.recordMovement(this.prisma, {
      organizationId: user.organizationId,
      accountId: dto.accountId,
      type: CashMovementType.CASH_WITHDRAWAL,
      amount: dto.amount,
      reason: dto.reason,
      createdById: user.id,
    });
    return this.toDto(movement);
  }

  async transfer(user: AuthenticatedUser, dto: CashTransferDto): Promise<CashMovementDto> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException("Счёт списания и зачисления должны отличаться");
    }
    const fromAccount = await this.assertAccount(user.organizationId, dto.fromAccountId);
    await this.assertAccount(user.organizationId, dto.toAccountId);
    if (fromAccount.currentBalance.toNumber() < dto.amount) {
      throw new BadRequestException("Недостаточно денег на счёте списания");
    }

    const transferGroupId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [outMovement] = await this.prisma.$transaction(async (tx) => {
      const out = await this.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: dto.fromAccountId,
        type: CashMovementType.TRANSFER_OUT,
        amount: dto.amount,
        reason: dto.reason,
        transferGroupId,
        createdById: user.id,
      });
      const inMovement = await this.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: dto.toAccountId,
        type: CashMovementType.TRANSFER_IN,
        amount: dto.amount,
        reason: dto.reason,
        transferGroupId,
        createdById: user.id,
      });
      return [out, inMovement];
    });

    return this.toDto(outMovement);
  }

  // Corrects a mistaken account balance by recording the signed difference
  // as a new ADJUSTMENT movement — never edits or removes what came before,
  // same convention as InventoryService.adjust().
  async adjust(user: AuthenticatedUser, dto: CashAdjustmentDto): Promise<CashMovementDto> {
    const account = await this.assertAccount(user.organizationId, dto.accountId);
    const delta = dto.actualBalance - account.currentBalance.toNumber();
    if (delta === 0) {
      throw new BadRequestException("Фактический остаток совпадает с текущим — корректировка не требуется");
    }
    const movement = await this.recordMovement(this.prisma, {
      organizationId: user.organizationId,
      accountId: dto.accountId,
      type: CashMovementType.ADJUSTMENT,
      amount: delta,
      reason: dto.reason,
      createdById: user.id,
    });
    return this.toDto(movement);
  }

  private async assertAccount(organizationId: string, accountId: string) {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) {
      throw new NotFoundException("Счёт не найден");
    }
    if (!account.isActive) {
      throw new BadRequestException("Счёт заархивирован");
    }
    return account;
  }

  private toDto = (movement: MovementWithIncludes): CashMovementDto => ({
    id: movement.id,
    accountId: movement.accountId,
    accountName: movement.account.name,
    type: movement.type as CashMovementDto["type"],
    amount: movement.amount.toNumber(),
    occurredAt: movement.occurredAt.toISOString(),
    reason: movement.reason,
    categoryId: movement.categoryId,
    categoryName: movement.categoryRef?.name ?? null,
    customerId: movement.customerId,
    customerName: movement.customer?.name ?? null,
    supplierId: movement.supplierId,
    supplierName: movement.supplier?.name ?? null,
    saleId: movement.saleId,
    expenseId: movement.expenseId,
    invoiceId: movement.invoiceId,
    correctsMovementId: movement.correctsMovementId,
    createdByName: movement.createdBy.fullName,
  });
}
