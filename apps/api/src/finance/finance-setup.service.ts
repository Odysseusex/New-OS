import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CashMovementType, FinanceSetupStatusDto } from "@bakery-os/shared";
import { InvoiceStatus as PrismaInvoiceStatus } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { FinanceService } from "./finance.service";
import { ReconcileInvoicesDto } from "./dto/reconcile-invoices.dto";

// "Запуск финансового учёта" — see the schema comment on
// Organization.financeInitializedAt for the full reasoning. This service
// only orchestrates already-existing primitives (Invoice.amountPaid,
// FinanceService's valuation/AR/AP methods) — it never writes CashMovement
// or StockMovement rows itself.
@Injectable()
export class FinanceSetupService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {}

  // Permanent, stable forever once initialized — see the guard in
  // CashAccountsService.create() that blocks new OPENING_BALANCE entries
  // after go-live, which is what makes summing this type indefinitely safe.
  private async getCashValue(organizationId: string): Promise<number> {
    const openingMovements = await this.prisma.cashMovement.findMany({
      where: { organizationId, type: CashMovementType.OPENING_BALANCE },
      select: { amount: true },
    });
    return openingMovements.reduce((sum, m) => sum + m.amount.toNumber(), 0);
  }

  // Same shape whether initialized (frozen fields) or not (live preview for
  // the wizard's review step) — the caller doesn't need two DTOs.
  async getStatus(organizationId: string): Promise<FinanceSetupStatusDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { financeInitializedBy: true },
    });
    const initialized = org.financeInitializedAt !== null;

    const [cashValue, inventoryValuation, liveReceivables, livePayables] = await Promise.all([
      this.getCashValue(organizationId),
      this.financeService.getInventoryValuation(organizationId),
      this.financeService.getAccountsReceivable(organizationId),
      this.financeService.getAccountsPayable(organizationId),
    ]);

    const inventoryValue = initialized ? org.openingInventoryValue!.toNumber() : inventoryValuation.totalValue;
    const receivablesValue = initialized ? org.openingReceivablesValue!.toNumber() : liveReceivables;
    const payablesValue = initialized ? org.openingPayablesValue!.toNumber() : livePayables;

    const totalAssets = cashValue + inventoryValue + receivablesValue;
    const totalLiabilities = payablesValue;
    const equity = totalAssets - totalLiabilities;

    return {
      initialized,
      initializedAt: org.financeInitializedAt ? org.financeInitializedAt.toISOString() : null,
      initializedByName: org.financeInitializedBy?.fullName ?? null,
      cashValue,
      inventoryValue,
      // Diagnostic only — how many stock lines have no knowable cost right
      // now. Always live: not part of the frozen equation, just a nudge to
      // fix recipes/purchase history before (or after) locking in.
      inventoryUnknownValueLineItems: inventoryValuation.unknownValueLineItems,
      receivablesValue,
      payablesValue,
      totalAssets,
      totalLiabilities,
      equity,
    };
  }

  // Bulk-mark pre-existing confirmed invoices as (fully or partially)
  // settled before the Finance module existed. No CashMovement is created —
  // that payment happened before the ledger did, and the cash opening
  // balance entered in step 1 already reflects its net effect. Only
  // possible before go-live: once initialized, any further invoice payment
  // must go through the ordinary recordPayment() flow, which does create a
  // real CashMovement — this bypass is exclusively for pre-ledger history.
  async reconcileInvoices(user: AuthenticatedUser, dto: ReconcileInvoicesDto): Promise<{ updated: number }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    if (org.financeInitializedAt) {
      throw new ConflictException("Финансовый учёт уже запущен — сверка задним числом больше недоступна");
    }

    const invoiceIds = dto.items.map((i) => i.invoiceId);
    const invoices = await this.prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, organizationId: user.organizationId },
    });
    if (invoices.length !== new Set(invoiceIds).size) {
      throw new NotFoundException("Одна или несколько накладных не найдены");
    }
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    for (const item of dto.items) {
      const invoice = invoiceById.get(item.invoiceId)!;
      if (invoice.status !== PrismaInvoiceStatus.CONFIRMED) {
        throw new BadRequestException(`Накладная №${invoice.number} не проведена — сверять нечего`);
      }
      if (item.amountPaid > invoice.totalCost.toNumber()) {
        throw new BadRequestException(`Сумма оплаты по накладной №${invoice.number} больше её суммы`);
      }
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.invoice.update({ where: { id: item.invoiceId }, data: { amountPaid: item.amountPaid } }),
      ),
    );

    return { updated: dto.items.length };
  }

  async complete(user: AuthenticatedUser): Promise<FinanceSetupStatusDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    if (org.financeInitializedAt) {
      throw new ConflictException("Запуск финансового учёта уже завершён");
    }

    const [inventoryValuation, receivablesValue, payablesValue] = await Promise.all([
      this.financeService.getInventoryValuation(user.organizationId),
      this.financeService.getAccountsReceivable(user.organizationId),
      this.financeService.getAccountsPayable(user.organizationId),
    ]);

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        financeInitializedAt: new Date(),
        financeInitializedById: user.id,
        openingInventoryValue: inventoryValuation.totalValue,
        openingReceivablesValue: receivablesValue,
        openingPayablesValue: payablesValue,
      },
    });

    return this.getStatus(user.organizationId);
  }
}
