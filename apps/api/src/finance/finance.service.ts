import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ExpenseDto, ProductPnLDto, ProfitAndLossDto } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateExpenseDto } from "./dto/create-expense.dto";

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async listExpenses(organizationId: string, locationId?: string): Promise<ExpenseDto[]> {
    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, createdBy: true },
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

    const expense = await this.prisma.expense.create({
      data: {
        organizationId: user.organizationId,
        locationId: dto.locationId,
        category: dto.category,
        amount: dto.amount,
        description: dto.description,
        incurredOn: dto.incurredOn ? new Date(dto.incurredOn) : undefined,
        createdById: user.id,
      },
      include: { location: true, createdBy: true },
    });

    return this.toExpenseDto(expense);
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
      this.prisma.expense.findMany({
        where: {
          organizationId,
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
    const netProfit = grossProfit - expensesTotal;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      revenue,
      cogs,
      grossProfit,
      grossMarginPercent,
      expensesTotal,
      netProfit,
      unknownCostLineItems,
      byProduct,
    };
  }

  private toExpenseDto = (expense: {
    id: string;
    locationId: string | null;
    location: { name: string } | null;
    category: string;
    amount: { toNumber: () => number };
    description: string | null;
    incurredOn: Date;
    createdBy: { fullName: string };
  }): ExpenseDto => ({
    id: expense.id,
    locationId: expense.locationId,
    locationName: expense.location?.name ?? null,
    category: expense.category as ExpenseDto["category"],
    amount: expense.amount.toNumber(),
    description: expense.description,
    incurredOn: expense.incurredOn.toISOString(),
    createdByName: expense.createdBy.fullName,
  });
}
