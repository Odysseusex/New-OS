import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  BreakEvenDto,
  BreakEvenFixedCostLineDto,
  BreakEvenStatus,
  CASH_MOVEMENT_INFLOW_TYPES,
  CashAccountType,
  CashMovementType,
  CostBehavior,
  ExpenseDto,
  ExpenseStatus,
  FinanceDashboardDto,
  InventoryValuationDto,
  PaymentStatus,
  ProductPnLDto,
  ProductType,
  ProfitAndLossDto,
  Unit,
} from "@bakery-os/shared";
import { InvoiceStatus as PrismaInvoiceStatus } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashMovementsService } from "./cash-movements.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { RecordExpensePaymentDto } from "./dto/record-expense-payment.dto";

const EXPENSE_INCLUDE = { location: true, categoryRef: true, createdBy: true };

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private cashMovementsService: CashMovementsService,
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

      return created;
    });

    return this.toExpenseDto(expense);
  }

  async confirmExpense(organizationId: string, expenseId: string): Promise<ExpenseDto> {
    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId, organizationId } });
    if (!expense) {
      throw new NotFoundException("Расход не найден");
    }
    if (expense.status !== ExpenseStatus.DRAFT) {
      throw new BadRequestException("Расход уже подтверждён или отменён");
    }
    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: { status: ExpenseStatus.CONFIRMED },
      include: EXPENSE_INCLUDE,
    });
    return this.toExpenseDto(updated);
  }

  async cancelExpense(organizationId: string, expenseId: string): Promise<ExpenseDto> {
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
    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: { status: ExpenseStatus.CANCELLED },
      include: EXPENSE_INCLUDE,
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

  // Resolves a per-unit COST (never a sale price) for FINISHED_GOOD
  // products: recipe-derived cost first, weighted-average purchase cost as
  // fallback, `null` when neither exists — the same resolution used by P&L
  // COGS and by inventory valuation (getInventoryValuation), extracted here
  // so both stay in lockstep instead of drifting apart. Deliberately never
  // reads Product.price for a FINISHED_GOOD — see the schema comment on
  // Product.price for why that field cannot stand in for cost.
  private async resolveFinishedGoodUnitCosts(organizationId: string): Promise<Map<string, number>> {
    const [recipes, purchaseItems] = await Promise.all([
      this.prisma.recipe.findMany({
        where: { organizationId, isActive: true },
        include: { items: { include: { ingredientProduct: true } } },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: { purchaseOrder: { organizationId } },
      }),
    ]);

    // Ingredient-based cost for products that have a техкарта (recipe).
    const recipeCostByProduct = new Map<string, number>();
    for (const recipe of recipes) {
      const yieldQuantity = recipe.yieldQuantity.toNumber();
      if (yieldQuantity <= 0) continue;
      const totalIngredientCost = recipe.items.reduce(
        (sum, item) => sum + item.quantity.toNumber() * item.ingredientProduct.price.toNumber(),
        0,
      );
      recipeCostByProduct.set(recipe.productId, totalIngredientCost / yieldQuantity);
    }

    // Fallback for products without a recipe: weighted-average purchase cost.
    const purchaseAgg = new Map<string, { totalCost: number; totalQty: number }>();
    for (const item of purchaseItems) {
      const entry = purchaseAgg.get(item.productId) ?? { totalCost: 0, totalQty: 0 };
      entry.totalCost += item.subtotal.toNumber();
      entry.totalQty += item.quantity.toNumber();
      purchaseAgg.set(item.productId, entry);
    }
    const avgPurchaseCostByProduct = new Map<string, number>();
    for (const [productId, agg] of purchaseAgg) {
      if (agg.totalQty > 0) avgPurchaseCostByProduct.set(productId, agg.totalCost / agg.totalQty);
    }

    const merged = new Map<string, number>(avgPurchaseCostByProduct);
    for (const [productId, cost] of recipeCostByProduct) merged.set(productId, cost);
    return merged;
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
      this.resolveFinishedGoodUnitCosts(organizationId),
    ]);

    let totalValue = 0;
    let unknownValueLineItems = 0;
    const byProduct = stockLevels.map((level) => {
      const quantity = level.quantity.toNumber();
      const unitCost =
        level.product.type === ProductType.RAW_MATERIAL
          ? level.product.price.toNumber()
          : (finishedGoodCosts.get(level.productId) ?? null);
      const hasCostData = unitCost !== null;
      if (!hasCostData) unknownValueLineItems += 1;
      const value = hasCostData ? unitCost * quantity : 0;
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

    return { totalValue, unknownValueLineItems, byProduct };
  }

  async getProfitAndLoss(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Promise<ProfitAndLossDto> {
    const [sales, unitCosts, expenses] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          organizationId,
          soldAt: { gte: from, lte: to },
          ...(locationId ? { locationId } : {}),
        },
        include: { items: { include: { product: true } } },
      }),
      this.resolveFinishedGoodUnitCosts(organizationId),
      // Only confirmed obligations count toward P&L — a draft expense isn't
      // a real cost yet, a cancelled one never was.
      this.prisma.expense.findMany({
        where: {
          organizationId,
          status: ExpenseStatus.CONFIRMED,
          incurredOn: { gte: from, lte: to },
          ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : {}),
        },
      }),
    ]);

    const costFor = (productId: string): number | null => unitCosts.get(productId) ?? null;

    const byProductMap = new Map<string, ProductPnLDto>();
    let unknownCostLineItems = 0;

    for (const sale of sales) {
      for (const item of sale.items) {
        const quantity = item.quantity.toNumber();
        const revenue = item.subtotal.toNumber();
        const unitCost = costFor(item.productId);
        const hasCost = unitCost !== null;
        if (!hasCost) unknownCostLineItems += 1;
        const cogs = hasCost ? unitCost * quantity : 0;

        const existing = byProductMap.get(item.productId);
        if (existing) {
          existing.quantitySold += quantity;
          existing.revenue += revenue;
          existing.cogs += cogs;
          existing.hasCostData = existing.hasCostData && hasCost;
        } else {
          byProductMap.set(item.productId, {
            productId: item.productId,
            productName: item.product.name,
            quantitySold: quantity,
            revenue,
            cogs,
            grossProfit: 0,
            marginPercent: null,
            hasCostData: hasCost,
          });
        }
      }
    }

    const byProduct = Array.from(byProductMap.values())
      .map((p) => ({
        ...p,
        grossProfit: p.revenue - p.cogs,
        marginPercent: p.revenue > 0 ? ((p.revenue - p.cogs) / p.revenue) * 100 : null,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const revenue = sales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0);
    const cogs = byProduct.reduce((sum, p) => sum + p.cogs, 0);
    const grossProfit = revenue - cogs;
    const grossMarginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : null;
    const expensesTotal = expenses.reduce((sum, e) => sum + e.amount.toNumber(), 0);
    const operatingProfit = grossProfit - expensesTotal;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      revenue,
      cogs,
      grossProfit,
      grossMarginPercent,
      expensesTotal,
      operatingProfit,
      unknownCostLineItems,
      byProduct,
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
    const [unpaidInvoices, unpaidExpenses] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { organizationId, status: PrismaInvoiceStatus.CONFIRMED },
        select: { totalCost: true, amountPaid: true },
      }),
      this.prisma.expense.findMany({
        where: { organizationId, status: ExpenseStatus.CONFIRMED },
        select: { amount: true, amountPaid: true },
      }),
    ]);
    return (
      unpaidInvoices.reduce((sum, i) => sum + Math.max(0, i.totalCost.toNumber() - i.amountPaid.toNumber()), 0) +
      unpaidExpenses.reduce((sum, e) => sum + Math.max(0, e.amount.toNumber() - e.amountPaid.toNumber()), 0)
    );
  }

  // Powers the owner dashboard's at-a-glance cards. Balances/AR/AP are
  // point-in-time (as of now); profit figures cover the given period,
  // defaulting to the current calendar month.
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
      netProfit: pnl.operatingProfit,
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
