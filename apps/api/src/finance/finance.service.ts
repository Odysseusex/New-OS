import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../costing/costing.service";
import { FinancialEventProjector } from "./events/projector";
import { PeriodGuard } from "./periods/period-guard";
import { AccountingPolicyService } from "./accounting-policy.service";
import { isExplicitlyNotDepreciated, resolveDepreciableTerms } from "../fixed-assets/depreciation-calculators";
import { monthRange } from "../common/reporting-period";
import { signedCashAmount } from "./events/cash-events";
import { expenseAccrualEffect, isCategoryFullyClassified, pnlLineOfTreatment } from "./events/rules";
import { buildCashFlowFromEvents } from "./events/cash-flow-statement";
import { round2, round3 } from "../common/money";
import {
  BreakEvenDto,
  BreakEvenFixedCostLineDto,
  BreakEvenStatus,
  CASH_MOVEMENT_TYPE_LABELS_RU,
  CashFlowDto,
  CashFlowLineDto,
  CASH_MOVEMENT_INFLOW_TYPES,
  CashAccountType,
  CashMovementType,
  CompensationType,
  CostCoverageDto,
  InventoryLossKind,
  InventoryLossLineDto,
  INVENTORY_LOSS_KIND_LABELS_RU,
  NetProfitStatus,
  NotConfiguredItem,
  PnlLine,
  CostBehavior,
  DepreciationMethod,
  ExpenseDto,
  ExpenseStatus,
  FinanceDashboardDto,
  InventoryValuationDto,
  PayrollExclusionReason,
  PaymentStatus,
  PlannedBreakEvenDto,
  PlannedFixedCostDto,
  PlannedPayrollExclusionDto,
  ProductPnLDto,
  ProductType,
  ProfitAndLossDto,
  Unit,
} from "@bakery-os/shared";
import {
  EmployeeStatus as PrismaEmployeeStatus,
  StockMovementType,
  InvoiceStatus as PrismaInvoiceStatus,
} from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashMovementsService } from "./cash-movements.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { RecordExpensePaymentDto } from "./dto/record-expense-payment.dto";
import { recordAudit } from "../audit/audit";
import { postLedgerSources } from "../ledger/event-posting";

const EXPENSE_INCLUDE = { location: true, categoryRef: true, createdBy: true };

// Tenge to two decimals. Floating-point sums of money drift into
// 1234.5600000000002, which then renders as a nonsense figure on a statement
// the owner is meant to reconcile against a real bank balance.
const roundMoney = (value: number): number => Number(value.toFixed(2));

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private cashMovementsService: CashMovementsService,
    private costing: CostingService = new CostingService(prisma),
    private events: FinancialEventProjector = new FinancialEventProjector(prisma),
    private periodGuard: PeriodGuard = new PeriodGuard(prisma),
    private policyService: AccountingPolicyService = new AccountingPolicyService(prisma),
  ) {}

  async listExpenses(organizationId: string, locationId?: string): Promise<ExpenseDto[]> {
    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: EXPENSE_INCLUDE,
      orderBy: { incurredOn: "desc" },
      take: 200,
    });

    return expenses.map(this.toExpenseDto);
  }

  async createExpense(user: AuthenticatedUser, dto: CreateExpenseDto): Promise<ExpenseDto> {
    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, organizationId: user.organizationId },
      });
      if (!location) {
        throw new NotFoundException("Точка не найдена");
      }
    }
    if (dto.categoryId) {
      const category = await this.prisma.financeCategory.findFirst({
        where: { id: dto.categoryId, organizationId: user.organizationId },
      });
      if (!category) {
        throw new NotFoundException("Категория не найдена");
      }
    }

    // Fast path (default): logged and paid in one step, same as the flow
    // that existed before Expense had a lifecycle at all. Unchecked, it's
    // saved as a DRAFT with nothing paid yet — reviewed/confirmed later.
    const paidImmediately = dto.paidImmediately ?? true;
    if (paidImmediately && !dto.accountId) {
      throw new BadRequestException("Укажите счёт, с которого списаны деньги");
    }
    if (dto.accountId) {
      const account = await this.prisma.cashAccount.findFirst({
        where: { id: dto.accountId, organizationId: user.organizationId },
      });
      if (!account || !account.isActive) {
        throw new BadRequestException("Счёт не найден или заархивирован");
      }
    }

    // An expense dated inside a closed month would change a closed report.
    if (dto.incurredOn) await this.periodGuard.assertOpen(user.organizationId, new Date(dto.incurredOn));

    const expense = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          organizationId: user.organizationId,
          locationId: dto.locationId,
          categoryId: dto.categoryId,
          status: paidImmediately ? ExpenseStatus.CONFIRMED : ExpenseStatus.DRAFT,
          amount: dto.amount,
          amountPaid: paidImmediately ? dto.amount : 0,
          description: dto.description,
          incurredOn: dto.incurredOn ? new Date(dto.incurredOn) : undefined,
          createdById: user.id,
        },
        include: EXPENSE_INCLUDE,
      });

      if (paidImmediately) {
        await this.cashMovementsService.recordMovement(tx, {
          organizationId: user.organizationId,
          accountId: dto.accountId!,
          type: CashMovementType.EXPENSE_PAYMENT,
          amount: dto.amount,
          categoryId: dto.categoryId,
          expenseId: created.id,
          reason: dto.description,
          createdById: user.id,
        });
      }

      // A confirmed expense is accrued (payable + its P&L/balance line) at once.
      if (created.status === ExpenseStatus.CONFIRMED) {
        await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { expenseIds: [created.id] } });
      }

      return created;
    });

    return this.toExpenseDto(expense);
  }

  async confirmExpense(organizationId: string, expenseId: string, actorId: string | null): Promise<ExpenseDto> {
    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId, organizationId } });
    if (!expense) {
      throw new NotFoundException("Расход не найден");
    }
    if (expense.status !== ExpenseStatus.DRAFT) {
      throw new BadRequestException("Расход уже подтверждён или отменён");
    }
    await this.periodGuard.assertOpen(organizationId, expense.incurredOn);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional, so two simultaneous confirmations cannot both go through.
      const flipped = await tx.expense.updateMany({
        where: { id: expenseId, status: ExpenseStatus.DRAFT },
        data: { status: ExpenseStatus.CONFIRMED },
      });
      if (flipped.count !== 1) {
        throw new BadRequestException("Расход уже подтверждён или отменён");
      }
      const saved = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, include: EXPENSE_INCLUDE });
      await postLedgerSources(tx, { organizationId, actorId: actorId ?? saved.createdById, scope: { expenseIds: [expenseId] } });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: "expense.confirm",
        entityType: "Expense",
        entityId: expenseId,
        before: { status: expense.status, amount: expense.amount },
        after: { status: ExpenseStatus.CONFIRMED, amount: expense.amount },
      });
      return saved;
    });
    return this.toExpenseDto(updated);
  }

  async cancelExpense(organizationId: string, expenseId: string, actorId: string | null): Promise<ExpenseDto> {
    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId, organizationId } });
    if (!expense) {
      throw new NotFoundException("Расход не найден");
    }
    if (expense.status === ExpenseStatus.CANCELLED) {
      throw new BadRequestException("Расход уже отменён");
    }
    if (expense.amountPaid.toNumber() > 0) {
      throw new BadRequestException("Нельзя отменить расход, по которому уже прошла оплата");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.expense.update({
        where: { id: expenseId },
        data: { status: ExpenseStatus.CANCELLED },
        include: EXPENSE_INCLUDE,
      });
      // The accrual no longer stands: its entry is cancelled by a reversal.
      await postLedgerSources(tx, { organizationId, actorId: actorId ?? saved.createdById, scope: { expenseIds: [expenseId] } });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: "expense.cancel",
        entityType: "Expense",
        entityId: expenseId,
        before: { status: expense.status, amount: expense.amount },
        after: { status: ExpenseStatus.CANCELLED, amount: expense.amount },
      });
      return saved;
    });
    return this.toExpenseDto(updated);
  }

  async recordExpensePayment(
    user: AuthenticatedUser,
    expenseId: string,
    dto: RecordExpensePaymentDto,
  ): Promise<ExpenseDto> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, organizationId: user.organizationId },
    });
    if (!expense) {
      throw new NotFoundException("Расход не найден");
    }
    if (expense.status !== ExpenseStatus.CONFIRMED) {
      throw new BadRequestException("Сначала подтвердите расход");
    }
    const balanceDue = expense.amount.toNumber() - expense.amountPaid.toNumber();
    if (dto.amount > balanceDue) {
      throw new BadRequestException("Сумма оплаты превышает остаток задолженности");
    }
    const account = await this.prisma.cashAccount.findFirst({
      where: { id: dto.accountId, organizationId: user.organizationId },
    });
    if (!account || !account.isActive) {
      throw new BadRequestException("Счёт не найден или заархивирован");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.cashMovementsService.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: dto.accountId,
        type: CashMovementType.EXPENSE_PAYMENT,
        amount: dto.amount,
        categoryId: expense.categoryId ?? undefined,
        expenseId: expense.id,
        reason: expense.description ?? undefined,
        createdById: user.id,
      });
      return tx.expense.update({
        where: { id: expenseId },
        data: { amountPaid: { increment: dto.amount } },
        include: EXPENSE_INCLUDE,
      });
    });

    return this.toExpenseDto(updated);
  }

  // Values every product currently on hand as an asset — for the "Запуск
  // финансового учёта" opening balance and for anyone wanting a current
  // stock valuation later. RAW_MATERIAL uses Product.price directly (that
  // field IS cost for raw materials — see the schema comment). FINISHED_GOOD
  // NEVER uses Product.price (that's the sale price for that type); it goes
  // through the same recipe-cost/purchase-cost resolution as P&L COGS.
  // Products with neither a recipe nor purchase history are reported with
  // hasCostData=false and excluded from totalValue rather than guessed at.
  async getInventoryValuation(organizationId: string): Promise<InventoryValuationDto> {
    const [stockLevels, finishedGoodCosts] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { organizationId, quantity: { gt: 0 } },
        include: { product: true, location: true },
      }),
      this.costing.currentUnitCosts(organizationId),
    ]);

    let totalValue = 0;
    let unknownValueLineItems = 0;
    const byProduct = stockLevels.map((level) => {
      const quantity = level.quantity.toNumber();
      const unitCost = finishedGoodCosts.get(level.productId)?.unitCost ?? null;
      const hasCostData = unitCost !== null;
      if (!hasCostData) unknownValueLineItems += 1;
      const value = hasCostData ? round2(unitCost * quantity) : 0;
      totalValue += value;

      return {
        productId: level.productId,
        productName: level.product.name,
        locationId: level.locationId,
        locationName: level.location.name,
        unit: level.product.unit as Unit,
        quantity,
        unitCost,
        value,
        hasCostData,
      };
    });

    byProduct.sort((a, b) => b.value - a.value);

    return { totalValue: round2(totalValue), unknownValueLineItems, byProduct };
  }

  async getProfitAndLoss(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Promise<ProfitAndLossDto> {
    const [sales, returns, movements, currentCosts, expenses] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          organizationId,
          soldAt: { gte: from, lte: to },
          ...(locationId ? { locationId } : {}),
        },
        include: { items: { include: { product: true } } },
      }),
      // Returns belong to the period they were handed back in, not the period
      // of the sale they reverse.
      this.prisma.saleReturn.findMany({
        where: {
          organizationId,
          returnedAt: { gte: from, lte: to },
          ...(locationId ? { locationId } : {}),
        },
        include: { items: { include: { product: true } } },
      }),
      // Stock that left or was corrected without a sale. A return-linked
      // WRITE_OFF is only the marker of a scrapped return (zero stock effect,
      // and its cost stays in COGS) — it is NOT an inventory loss.
      this.prisma.stockMovement.findMany({
        where: {
          organizationId,
          createdAt: { gte: from, lte: to },
          ...(locationId ? { locationId } : {}),
          OR: [
            { type: StockMovementType.WRITE_OFF, saleReturnId: null },
            { type: StockMovementType.ADJUSTMENT },
          ],
        },
        select: { productId: true, type: true, quantity: true, unitCost: true, stocktakeId: true },
      }),
      this.costing.currentUnitCosts(organizationId),
      // Only confirmed obligations count toward P&L — a draft expense isn't
      // a real cost yet, a cancelled one never was.
      this.prisma.expense.findMany({
        where: {
          organizationId,
          status: ExpenseStatus.CONFIRMED,
          incurredOn: { gte: from, lte: to },
          ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : {}),
        },
        include: { categoryRef: true },
      }),
    ]);

    // Unit cost for a line: the snapshot taken when it happened; consignment
    // terms for older consignment lines; only then TODAY's cost. The source is
    // counted so a report can say how much of its cost can still move.
    const coverage: CostCoverageDto = { snapshotLines: 0, fallbackLines: 0, unknownLines: 0 };
    const costOf = (snapshot: { toNumber: () => number } | null, consignment: { toNumber: () => number } | null, productId: string): number | null => {
      if (snapshot) {
        coverage.snapshotLines += 1;
        return snapshot.toNumber();
      }
      if (consignment) {
        coverage.snapshotLines += 1;
        return consignment.toNumber();
      }
      const current = currentCosts.get(productId);
      if (current) {
        coverage.fallbackLines += 1;
        return current.unitCost;
      }
      coverage.unknownLines += 1;
      return null;
    };

    const byProductMap = new Map<string, ProductPnLDto>();
    const productRow = (productId: string, name: string): ProductPnLDto => {
      let row = byProductMap.get(productId);
      if (!row) {
        row = {
          productId,
          productName: name,
          quantitySold: 0,
          revenue: 0,
          cogs: 0,
          grossProfit: 0,
          marginPercent: null,
          hasCostData: true,
        };
        byProductMap.set(productId, row);
      }
      return row;
    };

    let unknownCostLineItems = 0;
    let discountsTotal = 0;
    for (const sale of sales) {
      for (const item of sale.items) {
        const quantity = item.quantity.toNumber();
        const unitCost = costOf(item.unitCost, item.consignmentUnitCost, item.productId);
        const hasCost = unitCost !== null;
        if (!hasCost) unknownCostLineItems += 1;
        const row = productRow(item.productId, item.product.name);
        row.quantitySold += quantity;
        row.revenue += item.subtotal.toNumber();
        row.cogs += hasCost ? round2(unitCost * quantity) : 0;
        row.hasCostData = row.hasCostData && hasCost;
        if (item.fullUnitPrice) {
          discountsTotal += round2((item.fullUnitPrice.toNumber() - item.unitPrice.toNumber()) * quantity);
        }
      }
    }

    // Returns: revenue always reverses. Cost of goods reverses only when the
    // goods went back on the shelf — a scrapped return keeps its COGS, the
    // loaf really was made and is really gone. Cost reverses at what the SALE
    // booked (copied onto the return line), never at today's cost.
    for (const ret of returns) {
      for (const item of ret.items) {
        const quantity = item.quantity.toNumber();
        const row = productRow(item.productId, item.product.name);
        row.quantitySold -= quantity;
        row.revenue -= item.subtotal.toNumber();
        if (ret.restocked) {
          const unitCost = costOf(item.unitCost, item.consignmentUnitCost, item.productId);
          if (unitCost !== null) row.cogs -= round2(unitCost * quantity);
        }
      }
    }

    const byProduct = Array.from(byProductMap.values())
      .map((p) => {
        const revenue = round2(p.revenue);
        const cogs = round2(p.cogs);
        return {
          ...p,
          quantitySold: round3(p.quantitySold),
          revenue,
          cogs,
          grossProfit: round2(revenue - cogs),
          marginPercent: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const salesTotal = round2(sales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0));
    const returnsTotal = round2(returns.reduce((sum, r) => sum + r.totalAmount.toNumber(), 0));
    discountsTotal = round2(discountsTotal);
    const grossRevenue = round2(salesTotal + discountsTotal);
    const netRevenue = round2(grossRevenue - discountsTotal - returnsTotal);
    const cogs = round2(byProduct.reduce((sum, p) => sum + p.cogs, 0));
    const grossProfit = round2(netRevenue - cogs);
    const grossMarginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : null;

    // Inventory losses: signed stock effect × the cost stamped on the row.
    // A shortage is a loss (+), a surplus a gain (−); write-offs are always losses.
    const lossByKind = new Map<InventoryLossKind, { amount: number; count: number }>();
    let unknownCostLossItems = 0;
    for (const m of movements) {
      const kind =
        m.type === StockMovementType.WRITE_OFF
          ? InventoryLossKind.WRITE_OFF
          : m.stocktakeId
            ? InventoryLossKind.STOCKTAKE
            : InventoryLossKind.ADJUSTMENT;
      // Loss quantity: write-off rows store a positive quantity that leaves
      // stock; adjustments store the signed delta, so a shortage is negative.
      const lossQuantity = m.type === StockMovementType.WRITE_OFF ? m.quantity.toNumber() : -m.quantity.toNumber();
      const unitCost = costOf(m.unitCost, null, m.productId);
      if (unitCost === null) {
        unknownCostLossItems += 1;
        continue;
      }
      const entry = lossByKind.get(kind) ?? { amount: 0, count: 0 };
      entry.amount += round2(lossQuantity * unitCost);
      entry.count += 1;
      lossByKind.set(kind, entry);
    }
    const inventoryLossLines: InventoryLossLineDto[] = Array.from(lossByKind.entries()).map(([kind, v]) => ({
      kind,
      label: INVENTORY_LOSS_KIND_LABELS_RU[kind],
      amount: round2(v.amount),
      count: v.count,
    }));
    const inventoryLosses = round2(inventoryLossLines.reduce((sum, l) => sum + l.amount, 0));

    // Expenses by what their category says they are (single rule set shared
    // with the cash-flow statement): operating expense, other/financial result,
    // recorded income tax, or a capital purchase that never reaches the P&L. A
    // category with no classification keeps counting as an operating expense —
    // what the system has always done — and is reported as such.
    const results = await this.categoryResults(organizationId, from, to, locationId, expenses);
    const extras = await this.periodExtras(organizationId, from, to, locationId);
    const expensesTotal = round2(results.operatingExpenses);
    const operatingProfit = round2(grossProfit - inventoryLosses - expensesTotal - extras.depreciation);
    const otherResult = round2(results.otherResult + extras.otherResult);
    const profitBeforeTax = round2(operatingProfit + otherResult);
    // Income tax has no approved policy: what was RECORDED is shown; without any
    // record it is unknown (null), never assumed to be 0%. Either way the bottom
    // line stays preliminary until the policy exists.
    const incomeTax: number | null = results.taxRecorded ? round2(results.incomeTax) : null;
    const notConfigured = [NotConfiguredItem.INCOME_TAX, ...extras.notConfigured];

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      grossRevenue,
      discountsTotal,
      returnsTotal,
      netRevenue,
      revenue: netRevenue,
      cogs,
      grossProfit,
      grossMarginPercent,
      inventoryLosses,
      inventoryLossLines,
      unknownCostLossItems,
      expensesTotal,
      depreciation: extras.depreciation,
      operatingProfit,
      otherResult,
      profitBeforeTax,
      incomeTax,
      unclassifiedExpensesTotal: round2(results.unclassifiedExpenses),
      capitalizedExpensesTotal: round2(results.capitalized),
      netProfit: round2(profitBeforeTax - (incomeTax ?? 0)),
      netProfitStatus: notConfigured.length === 0 ? NetProfitStatus.COMPLETE : NetProfitStatus.PRELIMINARY,
      notConfigured,
      unknownCostLineItems,
      costCoverage: coverage,
      costingMethod: this.costing.methodLabel,
      byProduct,
    };
  }

  private async categoryResults(
    organizationId: string,
    from: Date,
    to: Date,
    locationId: string | undefined,
    expenses: { amount: { toNumber: () => number }; categoryRef: { pnlTreatment: string; cashActivity: string; balanceTreatment: string } | null }[],
  ) {
    const out = {
      operatingExpenses: 0,
      otherResult: 0,
      incomeTax: 0,
      taxRecorded: false,
      unclassifiedExpenses: 0,
      capitalized: 0,
    };
    const add = (line: PnlLine | null, amount: number) => {
      switch (line) {
        case PnlLine.OPERATING_EXPENSE:
          out.operatingExpenses += amount;
          break;
        case PnlLine.OTHER_EXPENSE:
        case PnlLine.FINANCIAL_EXPENSE:
          out.otherResult -= amount;
          break;
        case PnlLine.INCOME_TAX:
          out.incomeTax += amount;
          out.taxRecorded = true;
          break;
        default:
          out.capitalized += amount;
      }
    };
    for (const e of expenses) {
      const effect = expenseAccrualEffect(e.categoryRef);
      const amount = e.amount.toNumber();
      if (effect.unclassified) out.unclassifiedExpenses += amount;
      add(effect.pnlLine, amount);
    }

    // Money that is a result by itself, with no expense document behind it: an
    // other-income receipt, a classified cash adjustment, a direct withdrawal
    // booked to an expense category. Only fully classified categories count;
    // the rest are visible in the cash-flow statement as unclassified.
    const direct = await this.prisma.cashMovement.findMany({
      where: {
        organizationId,
        occurredAt: { gte: from, lte: to },
        expenseId: null,
        type: {
          in: [
            CashMovementType.OTHER_INCOME,
            CashMovementType.OTHER_EXPENSE,
            CashMovementType.ADJUSTMENT,
            CashMovementType.CASH_DEPOSIT,
            CashMovementType.CASH_WITHDRAWAL,
          ],
        },
        categoryRef: { isNot: null },
        ...(locationId ? { account: { OR: [{ locationId }, { locationId: null }] } } : {}),
      },
      include: { categoryRef: true },
    });
    for (const m of direct) {
      const category = m.categoryRef!;
      if (!isCategoryFullyClassified(category)) continue;
      const line = pnlLineOfTreatment(category.pnlTreatment);
      if (!line) continue;
      const signed = signedCashAmount(m.type, m.amount.toNumber());
      if (line === PnlLine.OTHER_INCOME || line === PnlLine.FINANCIAL_INCOME) out.otherResult += signed;
      else add(line, -signed);
    }
    return out;
  }

  // Everything that sits between operating profit and net profit and comes
  // from modules built later (depreciation, financial/other results). Kept as
  // one seam so those phases extend this and nothing else in the P&L.
  private async periodExtras(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Promise<{ depreciation: number; otherResult: number; notConfigured: NotConfiguredItem[] }> {
    const scope = locationId ? { OR: [{ locationId }, { locationId: null }] } : {};
    const [entries, disposals, activeAssets, policy] = await Promise.all([
      // Depreciation belongs to the month it was posted for, dated the last
      // instant of that month; it is in the period when that instant is.
      this.prisma.depreciationEntry.findMany({
        where: {
          organizationId,
          year: { gte: from.getUTCFullYear() - 1, lte: to.getUTCFullYear() + 1 },
          asset: scope,
        },
        select: { year: true, month: true, amount: true },
      }),
      this.prisma.fixedAsset.findMany({
        where: { organizationId, status: "DISPOSED", disposedAt: { gte: from, lte: to }, ...scope },
        select: { disposalResult: true },
      }),
      this.prisma.fixedAsset.findMany({
        where: { organizationId, status: "ACTIVE", ...scope },
        select: {
          acquisitionCost: true,
          depreciationMethod: true,
          usefulLifeMonths: true,
          salvageValue: true,
          depreciationStartYear: true,
          depreciationStartMonth: true,
        },
      }),
      this.policyService.get(organizationId),
    ]);

    const depreciation = round2(
      entries
        .filter((e) => {
          const end = monthRange(e.year, e.month).end.getTime();
          return end >= from.getTime() && end <= to.getTime();
        })
        .reduce((sum, e) => sum + e.amount.toNumber(), 0),
    );
    // Gain or loss on assets that left in the period: an "other" result.
    const otherResult = round2(disposals.reduce((sum, d) => sum + (d.disposalResult?.toNumber() ?? 0), 0));

    // An asset that neither depreciates on stated terms nor is explicitly marked
    // "not depreciated" is undecided — and the statement says so.
    const policyMethod =
      policy.depreciationMethod.source === "APPROVED" ? (policy.depreciationMethod.value as DepreciationMethod) : null;
    const policyLife = policy.depreciationUsefulLifeMonths.source === "APPROVED" ? policy.depreciationUsefulLifeMonths.value : null;
    const undecided = activeAssets.some(
      (a) => !resolveDepreciableTerms(a, policyMethod, policyLife) && !isExplicitlyNotDepreciated(a, policyMethod),
    );
    return {
      depreciation,
      otherResult,
      notConfigured: undecided ? [NotConfiguredItem.DEPRECIATION_POLICY] : [],
    };
  }

  // Break-even/contribution-margin analysis for the period — reuses
  // getProfitAndLoss()'s revenue/cogs rather than recomputing them; the only
  // new input is FinanceCategory.costBehavior applied to the same CONFIRMED
  // expenses P&L already counts. Deliberately not a forecast — it answers
  // "at this period's actual margin, what revenue would have covered fixed
  // costs", using this period's own numbers, nothing projected forward.
  async getBreakEven(organizationId: string, from: Date, to: Date, locationId?: string): Promise<BreakEvenDto> {
    const [pnl, expenses] = await Promise.all([
      this.getProfitAndLoss(organizationId, from, to, locationId),
      this.prisma.expense.findMany({
        where: {
          organizationId,
          status: ExpenseStatus.CONFIRMED,
          incurredOn: { gte: from, lte: to },
          ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : {}),
        },
        include: { categoryRef: true },
      }),
    ]);

    let fixedExpensesTotal = 0;
    let variableExpensesTotal = 0;
    let unclassifiedExpensesTotal = 0;
    const fixedByCategory = new Map<string, { categoryName: string; amount: number }>();

    for (const expense of expenses) {
      // Only OPERATING expenses are costs of running the business: a capital
      // purchase, interest or income tax is not part of break-even.
      if (expenseAccrualEffect(expense.categoryRef).pnlLine !== PnlLine.OPERATING_EXPENSE) continue;
      const amount = expense.amount.toNumber();
      const behavior = expense.categoryRef?.costBehavior as CostBehavior | undefined;

      if (behavior === CostBehavior.FIXED) {
        fixedExpensesTotal += amount;
        const key = expense.categoryId ?? "uncategorized";
        const categoryName = expense.categoryRef?.name ?? "Без категории";
        const existing = fixedByCategory.get(key);
        if (existing) {
          existing.amount += amount;
        } else {
          fixedByCategory.set(key, { categoryName, amount });
        }
      } else if (behavior === CostBehavior.VARIABLE) {
        variableExpensesTotal += amount;
      } else {
        unclassifiedExpensesTotal += amount;
      }
    }

    const fixedCostLines: BreakEvenFixedCostLineDto[] = Array.from(fixedByCategory.entries())
      .map(([categoryId, v]) => ({ categoryId, categoryName: v.categoryName, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);

    const contributionMargin = pnl.revenue - (pnl.cogs + variableExpensesTotal);
    const contributionMarginPercent = pnl.revenue > 0 ? (contributionMargin / pnl.revenue) * 100 : null;

    let status: BreakEvenStatus;
    let breakEvenRevenue: number | null = null;

    if (pnl.revenue <= 0) {
      status = BreakEvenStatus.NO_SALES;
    } else if (fixedExpensesTotal <= 0) {
      status = BreakEvenStatus.NO_FIXED_COSTS_CLASSIFIED;
    } else if (contributionMargin <= 0) {
      status = BreakEvenStatus.NEGATIVE_MARGIN;
    } else {
      status = BreakEvenStatus.OK;
      breakEvenRevenue = fixedExpensesTotal / (contributionMargin / pnl.revenue);
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      status,
      revenue: pnl.revenue,
      cogs: pnl.cogs,
      variableExpensesTotal,
      fixedExpensesTotal,
      unclassifiedExpensesTotal,
      contributionMargin,
      contributionMarginPercent,
      breakEvenRevenue,
      fixedCostLines,
    };
  }

  // Planned-side break-even — the PLAN half of the plan/fact split.
  //
  // Reuses getBreakEven() wholesale for the contribution-margin ratio rather
  // than recomputing revenue/COGS/variable costs, so the planned and actual
  // views can never disagree about margin. The only thing swapped out is the
  // fixed-cost side: booked expenses give way to planned monthly pay rates
  // plus planned recurring costs.
  //
  // The result is always a MONTHLY revenue figure regardless of the selected
  // period — the margin ratio is scale-invariant so it transfers honestly,
  // but pro-rating a month of rent down to one day would read precise and
  // mean nothing.
  //
  // Nothing here writes: planned rows are never converted into Expense or
  // CashMovement, so a plan can never be double-counted against the actuals.
  async getPlannedBreakEven(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Promise<PlannedBreakEvenDto> {
    // Location scoping matches the expense convention used throughout
    // Finance: a location-scoped view includes both that location's own
    // costs and organization-wide ones, since org-wide costs really do
    // burden every location.
    const locationFilter = locationId ? { OR: [{ locationId }, { locationId: null }] } : {};

    const [actual, employees, plannedRows] = await Promise.all([
      this.getBreakEven(organizationId, from, to, locationId),
      this.prisma.employee.findMany({
        where: {
          organizationId,
          status: PrismaEmployeeStatus.ACTIVE,
          ...locationFilter,
        },
        include: { compensations: { where: { effectiveTo: null } } },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.plannedFixedCost.findMany({
        where: { organizationId, effectiveTo: null, ...locationFilter },
        include: { category: true, location: true, createdBy: true },
      }),
    ]);

    // Planned payroll: only MONTHLY rates can be summed into a monthly
    // total. Hourly/piece-rate staff have no planned hours or output volume
    // anywhere in the system, so any monthly figure for them would be
    // invented — they are excluded and reported by name instead of being
    // silently dropped, which would make the plan look more complete than
    // it is.
    let payrollTotal = 0;
    let includedEmployeeCount = 0;
    const nonMonthlyByType = new Map<CompensationType, string[]>();
    const withoutRate: string[] = [];

    for (const employee of employees) {
      const activeRate = employee.compensations[0];
      if (!activeRate) {
        withoutRate.push(employee.fullName);
        continue;
      }
      const paymentType = activeRate.paymentType as CompensationType;
      if (paymentType === CompensationType.MONTHLY) {
        payrollTotal += activeRate.amount.toNumber();
        includedEmployeeCount += 1;
      } else {
        const names = nonMonthlyByType.get(paymentType) ?? [];
        names.push(employee.fullName);
        nonMonthlyByType.set(paymentType, names);
      }
    }

    const exclusions: PlannedPayrollExclusionDto[] = [
      ...Array.from(nonMonthlyByType.entries()).map(([paymentType, employeeNames]) => ({
        reason: PayrollExclusionReason.NON_MONTHLY_RATE,
        paymentType,
        employeeCount: employeeNames.length,
        employeeNames,
      })),
      ...(withoutRate.length > 0
        ? [
            {
              reason: PayrollExclusionReason.NO_RATE_SET,
              paymentType: null,
              employeeCount: withoutRate.length,
              employeeNames: withoutRate,
            },
          ]
        : []),
    ];

    const plannedFixedCostLines: PlannedFixedCostDto[] = plannedRows
      .map((row) => ({
        id: row.id,
        categoryId: row.categoryId,
        categoryName: row.category.name,
        locationId: row.locationId,
        locationName: row.location?.name ?? null,
        amount: row.amount.toNumber(),
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: null as string | null,
        createdByName: row.createdBy.fullName,
        createdAt: row.createdAt.toISOString(),
      }))
      .sort((a, b) => b.amount - a.amount);

    const plannedOtherFixedTotal = plannedFixedCostLines.reduce((sum, line) => sum + line.amount, 0);
    const plannedFixedTotal = payrollTotal + plannedOtherFixedTotal;

    let status: BreakEvenStatus;
    let breakEvenRevenue: number | null = null;

    if (actual.revenue <= 0) {
      status = BreakEvenStatus.NO_SALES;
    } else if (plannedFixedTotal <= 0) {
      status = BreakEvenStatus.NO_PLANNED_FIXED_COSTS;
    } else if (actual.contributionMargin <= 0) {
      status = BreakEvenStatus.NEGATIVE_MARGIN;
    } else {
      status = BreakEvenStatus.OK;
      breakEvenRevenue = plannedFixedTotal / (actual.contributionMargin / actual.revenue);
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      status,
      revenue: actual.revenue,
      cogs: actual.cogs,
      variableExpensesTotal: actual.variableExpensesTotal,
      contributionMargin: actual.contributionMargin,
      contributionMarginPercent: actual.contributionMarginPercent,
      payroll: { total: payrollTotal, includedEmployeeCount, exclusions },
      plannedOtherFixedTotal,
      plannedFixedTotal,
      plannedFixedCostLines,
      breakEvenRevenue,
    };
  }

  // Sum of every unpaid balance on wholesale customer sales — the same
  // figure the Дебиторская задолженность tab and the dashboard card show,
  // extracted here so getDashboard and the finance-setup status endpoint
  // can't drift apart.
  async getAccountsReceivable(organizationId: string): Promise<number> {
    const unpaidSales = await this.prisma.sale.findMany({
      where: { organizationId, customerId: { not: null } },
      select: { totalAmount: true, amountPaid: true },
    });
    return unpaidSales.reduce((sum, s) => sum + Math.max(0, s.totalAmount.toNumber() - s.amountPaid.toNumber()), 0);
  }

  // Sum of every unpaid balance on confirmed supplier invoices and
  // confirmed expenses — same figure the Кредиторская задолженность tab
  // and the dashboard card show.
  async getAccountsPayable(organizationId: string): Promise<number> {
    const p = await this.getPayablesBreakdown(organizationId);
    return roundMoney(p.suppliers + p.expenses + p.consignment);
  }

  // The same figure split the way the balance sheet needs it. Supplier invoices
  // (legacy) and received purchase orders are separate documents and are each
  // counted once.
  async getPayablesBreakdown(organizationId: string): Promise<{ suppliers: number; expenses: number; consignment: number }> {
    const [unpaidInvoices, unpaidExpenses, consignmentOwed, orderPayables] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { organizationId, status: PrismaInvoiceStatus.CONFIRMED },
        select: { totalCost: true, amountPaid: true },
      }),
      this.prisma.expense.findMany({
        where: { organizationId, status: ExpenseStatus.CONFIRMED },
        select: { amount: true, amountPaid: true },
      }),
      // Goods sold on consignment are money owed to their owner just as much
      // as an unpaid supplier invoice is, and it is owed from the moment they
      // sell — so it belongs in Кредиторская задолженность rather than
      // appearing out of nowhere on the day of the payout.
      this.getConsignmentOwed(organizationId),
      this.getPurchaseOrderPayables(organizationId),
    ]);
    return {
      suppliers: roundMoney(
        unpaidInvoices.reduce((sum, i) => sum + Math.max(0, i.totalCost.toNumber() - i.amountPaid.toNumber()), 0) + orderPayables,
      ),
      expenses: roundMoney(unpaidExpenses.reduce((sum, e) => sum + Math.max(0, e.amount.toNumber() - e.amountPaid.toNumber()), 0)),
      consignment: roundMoney(consignmentOwed),
    };
  }

  // What is owed on purchase orders that were RECEIVED after the purchasing
  // cutover: the delivered total minus payments that have not been reversed.
  // A placed order owes nothing, and one received before the cutover is legacy
  // (settled outside the system) — neither is counted. Legacy supplier
  // invoices are counted above, separately, and never through this path, so a
  // delivery cannot be owed twice.
  async getPurchaseOrderPayables(organizationId: string): Promise<number> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { purchaseCutoverAt: true } });
    if (!org?.purchaseCutoverAt) return 0;
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { organizationId, status: "RECEIVED", receivedAt: { gte: org.purchaseCutoverAt } },
      select: { totalCost: true, receivedTotal: true, payments: { where: { reversedAt: null }, select: { amount: true } } },
    });
    return roundMoney(
      orders.reduce((sum, o) => {
        const due = (o.receivedTotal ?? o.totalCost).toNumber();
        const paid = o.payments.reduce((s, p) => s + p.amount.toNumber(), 0);
        return sum + Math.max(0, due - paid);
      }, 0),
    );
  }

  // Sold, minus returned, minus already paid — the same running balance the
  // Расчёты по реализации screen shows, kept here so the dashboard's
  // Кредиторская задолженность and that screen cannot drift apart.
  //
  // Clamped at zero per supplier: paying one supplier ahead must not quietly
  // cancel out what is genuinely owed to another.
  async getConsignmentOwed(organizationId: string): Promise<number> {
    const [saleItems, returnItems, payments] = await Promise.all([
      this.prisma.saleItem.findMany({
        where: { consignmentSupplierId: { not: null }, sale: { organizationId } },
        select: { consignmentSupplierId: true, consignmentUnitCost: true, quantity: true },
      }),
      this.prisma.saleReturnItem.findMany({
        where: { consignmentSupplierId: { not: null }, saleReturn: { organizationId } },
        select: { consignmentSupplierId: true, consignmentUnitCost: true, quantity: true },
      }),
      this.prisma.consignmentPayment.findMany({
        where: { organizationId },
        select: { supplierId: true, amount: true },
      }),
    ]);

    const bySupplier = new Map<string, number>();
    const add = (supplierId: string, delta: number) =>
      bySupplier.set(supplierId, (bySupplier.get(supplierId) ?? 0) + delta);

    for (const item of saleItems) {
      add(item.consignmentSupplierId!, (item.consignmentUnitCost?.toNumber() ?? 0) * item.quantity.toNumber());
    }
    for (const item of returnItems) {
      add(item.consignmentSupplierId!, -(item.consignmentUnitCost?.toNumber() ?? 0) * item.quantity.toNumber());
    }
    for (const payment of payments) {
      add(payment.supplierId, -payment.amount.toNumber());
    }

    return Number(
      [...bySupplier.values()].reduce((sum, owed) => sum + Math.max(0, owed), 0).toFixed(2),
    );
  }

  // Powers the owner dashboard's at-a-glance cards. Balances/AR/AP are
  // point-in-time (as of now); profit figures cover the given period,
  // defaulting to the current calendar month.
  // ДДС — движение денежных средств over a period.
  //
  // The dashboard already answers "what moved today". This answers the
  // month-scale question the owner plans against: where the money came from,
  // where it went, and whether the period ended fuller than it started.
  //
  // Opening balance is derived from every movement BEFORE `from` rather than
  // read off the account, so the statement reconciles for ANY period asked
  // for, not just one ending today: opening + inflow − outflow is always the
  // closing balance. Closing is then computed the same way rather than taken
  // from CashAccount.currentBalance, because a period ending in the past must
  // not report today's balance as its own.
  //
  // ADJUSTMENT is signed (mirroring StockMovement) and so is classified by
  // the sign of its amount, not by its type — the same rule the dashboard and
  // the Telegram bot already use.
  async getCashFlow(organizationId: string, from: Date, to: Date): Promise<CashFlowDto> {
    const [events, movements, accounts] = await Promise.all([
      this.events.project(organizationId, { upTo: to }),
      this.prisma.cashMovement.findMany({
        where: {
          organizationId,
          occurredAt: { gte: from, lte: to },
          // Internal transfers and opening balances are not money entering or
          // leaving the business; they have their own place in the statement.
          type: { notIn: [CashMovementType.TRANSFER_IN, CashMovementType.TRANSFER_OUT, CashMovementType.OPENING_BALANCE] },
        },
        include: { categoryRef: true },
      }),
      this.prisma.cashAccount.findMany({ where: { organizationId }, select: { currentBalance: true } }),
    ]);
    const statement = buildCashFlowFromEvents(events, from, to);

    const signedOf = (type: CashMovementType, amount: number): number =>
      type === CashMovementType.ADJUSTMENT
        ? amount
        : CASH_MOVEMENT_INFLOW_TYPES.includes(type)
          ? amount
          : -amount;

    const inflowByType = new Map<CashMovementType, { amount: number; count: number }>();
    const outflowByType = new Map<CashMovementType, { amount: number; count: number }>();
    const outflowByCategory = new Map<string | null, { categoryName: string; amount: number; count: number }>();
    let uncategorizedOutflow = 0;

    for (const m of movements) {
      const type = m.type as CashMovementType;
      const signed = signedOf(type, m.amount.toNumber());
      // A signed ADJUSTMENT of exactly zero moves nothing and belongs on
      // neither side; counting it as an outflow would inflate the count.
      if (signed === 0) continue;
      const magnitude = Math.abs(signed);
      const bucket = signed > 0 ? inflowByType : outflowByType;
      const entry = bucket.get(type) ?? { amount: 0, count: 0 };
      entry.amount += magnitude;
      entry.count += 1;
      bucket.set(type, entry);

      if (signed > 0) continue;
      // Grouped by category only on the way out: an inflow's category is
      // almost always just "выручка", while it is spending the owner needs
      // broken down to budget against.
      if (!m.categoryId) {
        uncategorizedOutflow += magnitude;
        continue;
      }
      const categoryEntry = outflowByCategory.get(m.categoryId) ?? {
        categoryName: m.categoryRef?.name ?? "Без категории",
        amount: 0,
        count: 0,
      };
      categoryEntry.amount += magnitude;
      categoryEntry.count += 1;
      outflowByCategory.set(m.categoryId, categoryEntry);
    }

    const toLines = (map: Map<CashMovementType, { amount: number; count: number }>): CashFlowLineDto[] =>
      Array.from(map.entries())
        .map(([type, v]) => ({
          type,
          label: CASH_MOVEMENT_TYPE_LABELS_RU[type],
          amount: roundMoney(v.amount),
          count: v.count,
        }))
        .sort((a, b) => b.amount - a.amount);

    // The ledger check only applies to a period that runs up to now: the
    // accounts' current balances describe the present, not an earlier date.
    const runsToNow = to.getTime() >= Date.now();
    const accountsBalance = roundMoney(accounts.reduce((sum, a) => sum + a.currentBalance.toNumber(), 0));
    const difference = roundMoney(statement.closingBalance - accountsBalance);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      openingBalance: statement.openingBalance,
      openingDeclaredInPeriod: statement.openingDeclaredInPeriod,
      closingBalance: statement.closingBalance,
      totalInflow: statement.totalInflow,
      totalOutflow: statement.totalOutflow,
      netFlow: roundMoney(statement.totalInflow - statement.totalOutflow),
      sections: statement.sections,
      internalTransfers: statement.internalTransfers,
      reconciliation: runsToNow ? { accountsBalance, difference, reconciles: difference === 0 } : null,
      inflowByType: toLines(inflowByType),
      outflowByType: toLines(outflowByType),
      outflowByCategory: Array.from(outflowByCategory.entries())
        .map(([categoryId, v]) => ({
          categoryId,
          categoryName: v.categoryName,
          amount: roundMoney(v.amount),
          count: v.count,
        }))
        .sort((a, b) => b.amount - a.amount),
      uncategorizedOutflow: roundMoney(uncategorizedOutflow),
    };
  }

  async getDashboard(organizationId: string, from?: Date, to?: Date): Promise<FinanceDashboardDto> {
    const periodTo = to ?? new Date();
    const periodFrom = from ?? new Date(periodTo.getFullYear(), periodTo.getMonth(), 1);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [accounts, todayMovements, accountsReceivable, accountsPayable, pnl] = await Promise.all([
      this.prisma.cashAccount.findMany({ where: { organizationId, isActive: true } }),
      this.prisma.cashMovement.findMany({ where: { organizationId, occurredAt: { gte: startOfToday } } }),
      this.getAccountsReceivable(organizationId),
      this.getAccountsPayable(organizationId),
      this.getProfitAndLoss(organizationId, periodFrom, periodTo),
    ]);

    const cashOnHand = accounts.reduce((sum, a) => sum + a.currentBalance.toNumber(), 0);
    const bankBalance = accounts
      .filter((a) => a.type === CashAccountType.BANK)
      .reduce((sum, a) => sum + a.currentBalance.toNumber(), 0);
    const cashRegisterBalance = accounts
      .filter((a) => a.type === CashAccountType.CASH)
      .reduce((sum, a) => sum + a.currentBalance.toNumber(), 0);

    let todayInflow = 0;
    let todayOutflow = 0;
    for (const m of todayMovements) {
      const amount = m.amount.toNumber();
      if (m.type === CashMovementType.ADJUSTMENT) {
        if (amount >= 0) todayInflow += amount;
        else todayOutflow += -amount;
      } else if (CASH_MOVEMENT_INFLOW_TYPES.includes(m.type as CashMovementType)) {
        todayInflow += amount;
      } else {
        todayOutflow += amount;
      }
    }

    return {
      cashOnHand,
      bankBalance,
      cashRegisterBalance,
      todayInflow,
      todayOutflow,
      accountsReceivable,
      accountsPayable,
      grossProfit: pnl.grossProfit,
      operatingProfit: pnl.operatingProfit,
      netProfit: pnl.netProfit,
      netProfitStatus: pnl.netProfitStatus,
      notConfigured: pnl.notConfigured,
      period: { from: periodFrom.toISOString(), to: periodTo.toISOString() },
    };
  }

  private toExpenseDto = (expense: {
    id: string;
    locationId: string | null;
    location: { name: string } | null;
    categoryId: string | null;
    categoryRef: { name: string } | null;
    status: string;
    amount: { toNumber: () => number };
    amountPaid: { toNumber: () => number };
    description: string | null;
    incurredOn: Date;
    createdBy: { fullName: string };
  }): ExpenseDto => {
    const amount = expense.amount.toNumber();
    const amountPaid = expense.amountPaid.toNumber();
    const balanceDue = amount - amountPaid;
    return {
      id: expense.id,
      locationId: expense.locationId,
      locationName: expense.location?.name ?? null,
      categoryId: expense.categoryId,
      categoryName: expense.categoryRef?.name ?? null,
      status: expense.status as ExpenseStatus,
      amount,
      amountPaid,
      balanceDue,
      paymentStatus:
        balanceDue <= 0 ? PaymentStatus.PAID : amountPaid > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID,
      description: expense.description,
      incurredOn: expense.incurredOn.toISOString(),
      createdByName: expense.createdBy.fullName,
    };
  };
}
