import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CASH_MOVEMENT_INFLOW_TYPES,
  CashMovementDto,
  CashMovementType,
  CategoryClassification,
  FinanceCategoryKind,
  isFullyClassified,
} from "@bakery-os/shared";
import { recordAudit } from "../audit/audit";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashDepositDto } from "./dto/cash-deposit.dto";
import { CashWithdrawalDto } from "./dto/cash-withdrawal.dto";
import { CashTransferDto } from "./dto/cash-transfer.dto";
import { CashAdjustmentDto } from "./dto/cash-adjustment.dto";
import { postLedgerSourcesOn } from "../ledger/event-posting";

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
  consignmentPaymentId?: string;
  purchaseOrderPaymentId?: string;
  fixedAssetId?: string;
  transferGroupId?: string;
  correctsMovementId?: string;
  createdById: string;
  // When set, an outflow only happens if the account holds at least that much
  // at the moment of the write (one conditional UPDATE); otherwise this message
  // is thrown. Only meaningful inside a transaction, so the movement row
  // created just before rolls back with it.
  insufficientBalanceMessage?: string;
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
        consignmentPaymentId: params.consignmentPaymentId,
        purchaseOrderPaymentId: params.purchaseOrderPaymentId,
        fixedAssetId: params.fixedAssetId,
        transferGroupId: params.transferGroupId,
        correctsMovementId: params.correctsMovementId,
        createdById: params.createdById,
      },
      include: MOVEMENT_INCLUDE,
    });

    if (params.insufficientBalanceMessage && delta < 0) {
      const result = await tx.cashAccount.updateMany({
        where: { id: params.accountId, currentBalance: { gte: -delta } },
        data: { currentBalance: { increment: delta } },
      });
      if (result.count !== 1) {
        throw new BadRequestException(params.insufficientBalanceMessage);
      }
    } else {
      await tx.cashAccount.update({
        where: { id: params.accountId },
        data: { currentBalance: { increment: delta } },
      });
    }

    // The general ledger follows the cash ledger: every movement is journalised
    // in the same transaction (a no-op while the ledger is off).
    await postLedgerSourcesOn(tx, {
      organizationId: params.organizationId,
      actorId: params.createdById,
      scope: { cashMovementIds: [movement.id] },
    });

    return movement;
  }

  async findAll(
    organizationId: string,
    opts: { accountId?: string; limit?: number; offset?: number; saleId?: string } = {},
  ): Promise<CashMovementDto[]> {
    const { accountId, limit = 100, offset = 0, saleId } = opts;
    const movements = await this.prisma.cashMovement.findMany({
      where: { organizationId, ...(accountId ? { accountId } : {}), ...(saleId ? { saleId } : {}) },
      include: MOVEMENT_INCLUDE,
      orderBy: { occurredAt: "desc" },
      skip: offset,
      take: limit,
    });
    return movements.map(this.toDto);
  }

  // The movement row and the balance change commit together or not at all —
  // previously they were two separate statements, so a failure between them
  // left a movement with no balance change (or the reverse).
  async deposit(user: AuthenticatedUser, dto: CashDepositDto): Promise<CashMovementDto> {
    await this.assertAccount(user.organizationId, dto.accountId);
    if (dto.categoryId) await this.assertCategory(user.organizationId, dto.categoryId, FinanceCategoryKind.INCOME);
    const movement = await this.prisma.$transaction((tx) =>
      this.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: dto.accountId,
        type: CashMovementType.CASH_DEPOSIT,
        amount: dto.amount,
        reason: dto.reason,
        categoryId: dto.categoryId,
        createdById: user.id,
      }),
    );
    return this.toDto(movement);
  }

  async withdraw(user: AuthenticatedUser, dto: CashWithdrawalDto): Promise<CashMovementDto> {
    const account = await this.assertAccount(user.organizationId, dto.accountId);
    if (account.currentBalance.toNumber() < dto.amount) {
      throw new BadRequestException("Недостаточно денег на счёте для снятия");
    }
    if (dto.categoryId) await this.assertCategory(user.organizationId, dto.categoryId, FinanceCategoryKind.EXPENSE);
    // Re-checked at the moment of the write as well: two withdrawals racing
    // past the read above can no longer overdraw the account together.
    const movement = await this.prisma.$transaction((tx) =>
      this.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: dto.accountId,
        type: CashMovementType.CASH_WITHDRAWAL,
        amount: dto.amount,
        reason: dto.reason,
        categoryId: dto.categoryId,
        createdById: user.id,
        insufficientBalanceMessage: "Недостаточно денег на счёте для снятия",
      }),
    );
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
        // Checked at the moment of the write, not only in the read above, so two
        // transfers racing past it cannot overdraw the source account together.
        insufficientBalanceMessage: "Недостаточно денег на счёте списания",
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
    await this.assertAccount(user.organizationId, dto.accountId);
    const movement = await this.prisma.$transaction(async (tx) => {
      // The difference is computed from the balance as it stands at the moment
      // of the write: the row is locked for the transaction, so a movement
      // landing between the read and the write cannot make the correction wrong.
      const locked = await tx.$queryRaw<{ currentBalance: Prisma.Decimal }[]>`
        SELECT "currentBalance" FROM "cash_accounts" WHERE id = ${dto.accountId} FOR UPDATE`;
      const delta = Number((dto.actualBalance - Number(locked[0].currentBalance)).toFixed(2));
      if (delta === 0) {
        throw new BadRequestException("Фактический остаток совпадает с текущим — корректировка не требуется");
      }
      // A shortage is an expense-kind event, an overage an income-kind one, and
      // either must belong to a category that says what it means.
      const category = await this.assertCategory(
        user.organizationId,
        dto.categoryId,
        delta > 0 ? FinanceCategoryKind.INCOME : FinanceCategoryKind.EXPENSE,
        tx,
      );
      if (!isFullyClassified(category as unknown as CategoryClassification)) {
        throw new BadRequestException(
          "У выбранной категории не настроена классификация — корректировка не может быть отнесена к отчётам",
        );
      }
      const created = await this.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: dto.accountId,
        type: CashMovementType.ADJUSTMENT,
        amount: delta,
        reason: dto.reason,
        categoryId: dto.categoryId,
        createdById: user.id,
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "cashAccount.adjust",
        entityType: "CashAccount",
        entityId: dto.accountId,
        after: { delta, categoryId: dto.categoryId, movementId: created.id },
        reason: dto.reason,
      });
      return created;
    });
    return this.toDto(movement);
  }

  private async assertCategory(
    organizationId: string,
    categoryId: string,
    kind: FinanceCategoryKind,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const category = await client.financeCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category || !category.isActive) {
      throw new BadRequestException("Категория не найдена или заархивирована");
    }
    if (category.kind !== kind) {
      throw new BadRequestException(
        kind === FinanceCategoryKind.INCOME
          ? "Для поступления нужна категория доходов"
          : "Для списания нужна категория расходов",
      );
    }
    return category;
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
