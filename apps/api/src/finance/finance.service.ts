import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CASH_MOVEMENT_INFLOW_TYPES,
  CashAccountType,
  CashMovementType,
  ExpenseDto,
  ExpenseStatus,
  FinanceDashboardDto,
  PaymentStatus,
  ProductPnLDto,
  ProfitAndLossDto,
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

  async getProfitAndLoss(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Promise<ProfitAndLossDto> {
    const [sales, recipes, purchaseItems, expenses] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          organizationId,
          soldAt: { gte: from, lte: to },
          ...(locationId ? { locationId } : {}),
        },
        include: { items: { include: { product: true } } },
      }),
      this.prisma.recipe.findMany({
        where: { organizationId, isActive: true },
        include: { items: { include: { ingredientProduct: true } } },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: { purchaseOrder: { organizationId } },
      }),
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

    const costFor = (productId: string): number | null =>
      recipeCostByProduct.get(productId) ?? avgPurchaseCostByProduct.get(productId) ?? null;

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

  // Powers the owner dashboard's at-a-glance cards. Balances/AR/AP are
  // point-in-time (as of now); profit figures cover the given period,
  // defaulting to the current calendar month.
  async getDashboard(organizationId: string, from?: Date, to?: Date): Promise<FinanceDashboardDto> {
    const periodTo = to ?? new Date();
    const periodFrom = from ?? new Date(periodTo.getFullYear(), periodTo.getMonth(), 1);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [accounts, todayMovements, unpaidSales, unpaidInvoices, unpaidExpenses, pnl] = await Promise.all([
      this.prisma.cashAccount.findMany({ where: { organizationId, isActive: true } }),
      this.prisma.cashMovement.findMany({ where: { organizationId, occurredAt: { gte: startOfToday } } }),
      this.prisma.sale.findMany({
        where: { organizationId, customerId: { not: null } },
        select: { totalAmount: true, amountPaid: true },
      }),
      this.prisma.invoice.findMany({
        where: { organizationId, status: PrismaInvoiceStatus.CONFIRMED },
        select: { totalCost: true, amountPaid: true },
      }),
      this.prisma.expense.findMany({
        where: { organizationId, status: ExpenseStatus.CONFIRMED },
        select: { amount: true, amountPaid: true },
      }),
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

    const accountsReceivable = unpaidSales.reduce(
      (sum, s) => sum + Math.max(0, s.totalAmount.toNumber() - s.amountPaid.toNumber()),
      0,
    );
    const accountsPayable =
      unpaidInvoices.reduce((sum, i) => sum + Math.max(0, i.totalCost.toNumber() - i.amountPaid.toNumber()), 0) +
      unpaidExpenses.reduce((sum, e) => sum + Math.max(0, e.amount.toNumber() - e.amountPaid.toNumber()), 0);

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
