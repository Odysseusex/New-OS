import { Injectable } from "@nestjs/common";
import {
  BUSINESS_CONTEXT_CURRENCY,
  BUSINESS_CONTEXT_MODULES,
  BUSINESS_CONTEXT_SCHEMA_VERSION,
  BUSINESS_CONTEXT_TIME_ZONE,
  type BusinessContextDto,
  type BusinessContextLevel,
  type BusinessContextModule,
  type BusinessContextProductDto,
  type BusinessContextRecipeDto,
  type BusinessContextScope,
  type ProductType,
  type Unit,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { resolveProductUnitCosts } from "../common/product-costs";
import { CustomersService } from "../customers/customers.service";
import { FinanceService } from "../finance/finance.service";
import { HrService } from "../hr/hr.service";
import { InventoryService } from "../inventory/inventory.service";
import { LocationsService } from "../locations/locations.service";
import { ProcurementService } from "../procurement/procurement.service";
import { ProductionService } from "../production/production.service";
import { ProductsService } from "../products/products.service";
import { QualityService } from "../quality/quality.service";
import { RecipesService } from "../recipes/recipes.service";
import { SalesService } from "../sales/sales.service";
import { ConsignmentService } from "../consignment/consignment.service";
import { AiAnalyticsService } from "./ai-analytics.service";

// Things ArAmir does not record at all — true regardless of period, org or
// export level. Stated in every export so the reading model knows where its
// evidence stops instead of filling the gap with a plausible guess.
//
// Each line is a fact about the schema that was CHECKED, not a guess about
// what might be missing: nothing goes on this list without someone having
// looked for the field and not found it.
const STRUCTURAL_LIMITATIONS = [
  "Фактический расход сырья на конкретную производственную партию не хранится. " +
    "Известен только нормативный расход по техкарте (раздел RECIPES) и общее " +
    "движение сырья по складу за период (INVENTORY). Отклонение «сколько ушло по " +
    "факту против нормы» по партии посчитать нельзя.",
  "Списания не привязаны к производственной партии. Списание — отдельное событие " +
    "со своей причиной (WRITEOFFS); связать его с конкретной партией, из которой " +
    "пришёл товар, система не позволяет. Сопоставлять производство и списания можно " +
    "только на уровне товара и периода.",
  "Исторических снимков складского остатка нет. current_stock в INVENTORY — это " +
    "остаток на момент generated_at, а не на конец периода. Остаток на начало " +
    "периода восстановить нельзя.",
  "Срок годности хранится только в техкарте товара (shelf_life_days) и не " +
    "привязан к партии или к остатку. «Сколько дней осталось у этой партии на " +
    "полке» система не знает.",
  "Сроки поставки (lead time) поставщиков не хранятся. Когда придёт заказ, если " +
    "разместить его сегодня, из этих данных вывести нельзя.",
  "Аналитики по логистике нет: маршруты и доставки фиксируются, но пробег, время " +
    "в пути и процент доставок вовремя не измеряются.",
  "Себестоимость считается по ТЕКУЩИМ ценам сырья, а не по ценам на дату продажи. " +
    "Историческая динамика себестоимости недоступна.",
];

// What each level actually carries.
//
// BUSINESS and FULL both carry every module and every row of the aggregate
// tables — the instruction was explicit that the main mode must not be made
// small for the sake of file size, and nothing here decides in advance which
// figure a model will not need. They differ only in how deep the day-by-day
// history goes, which is genuinely the one axis in this export that grows
// without bound.
//
// QUICK is the exception, and deliberately so: it exists for a short question
// about right now. It keeps every headline number and every product, and
// drops only the high-volume breakdown tables — which is stated in the
// export's own warnings, so a model reading a QUICK context knows there is a
// fuller one to ask for rather than concluding the data does not exist.
const UNLIMITED = Number.MAX_SAFE_INTEGER;

interface LevelDetail {
  dailyPoints: number;
  hourlyBreakdown: boolean;
  cashFlowBreakdown: boolean;
  customerRows: number;
  purchaseProductRows: number;
}

const LEVEL_DETAIL: Record<BusinessContextLevel, LevelDetail> = {
  quick: {
    dailyPoints: 14,
    hourlyBreakdown: false,
    cashFlowBreakdown: false,
    customerRows: 10,
    purchaseProductRows: 10,
  },
  business: {
    dailyPoints: 92,
    hourlyBreakdown: true,
    cashFlowBreakdown: true,
    customerRows: UNLIMITED,
    purchaseProductRows: UNLIMITED,
  },
  full: {
    dailyPoints: UNLIMITED,
    hourlyBreakdown: true,
    cashFlowBreakdown: true,
    customerRows: UNLIMITED,
    purchaseProductRows: UNLIMITED,
  },
};

@Injectable()
export class BusinessContextService {
  constructor(
    private prisma: PrismaService,
    private salesService: SalesService,
    private financeService: FinanceService,
    private qualityService: QualityService,
    private locationsService: LocationsService,
    private recipesService: RecipesService,
    private productsService: ProductsService,
    private productionService: ProductionService,
    private inventoryService: InventoryService,
    private procurementService: ProcurementService,
    private customersService: CustomersService,
    private hrService: HrService,
    private consignmentService: ConsignmentService,
    private aiAnalyticsService: AiAnalyticsService,
  ) {}

  // Headline cash flow always; the per-type and per-category breakdowns only
  // where the level carries that much detail. The totals stay correct either
  // way — only the itemisation behind them is dropped.
  private async cashFlowFor(organizationId: string, from: Date, to: Date, detail: LevelDetail) {
    const cashFlow = await this.financeService.getCashFlow(organizationId, from, to);
    if (detail.cashFlowBreakdown) return cashFlow;
    return { ...cashFlow, inflowByType: [], outflowByType: [], outflowByCategory: [] };
  }

  // Assembles the whole context by PROJECTING what each module's own service
  // already computes. Nothing here recalculates a business figure a second
  // way: revenue comes from SalesService, COGS and margin from the same
  // resolution the P&L charges, write-offs from QualityService. That is what
  // guarantees this export and the on-screen reports can never disagree.
  async build(
    user: AuthenticatedUser,
    options: {
      from: Date;
      to: Date;
      level: BusinessContextLevel;
      locationId?: string;
      modules?: BusinessContextModule[];
    },
  ): Promise<BusinessContextDto> {
    const { from, to, level } = options;
    const locationId = options.locationId?.trim() || undefined;
    const modules = options.modules?.length ? options.modules : [...BUSINESS_CONTEXT_MODULES];
    const has = (module: BusinessContextModule) => modules.includes(module);
    const detail = LEVEL_DETAIL[level];

    const warnings: string[] = [];
    const limitations = [...STRUCTURAL_LIMITATIONS];

    const [organization, allLocations, products, unitCosts] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { name: true, financeInitializedAt: true },
      }),
      this.locationsService.findAllForOrganization(user.organizationId, true),
      this.productsService.findAllForOrganization(user.organizationId, true),
      resolveProductUnitCosts(this.prisma, user.organizationId),
    ]);

    const scopedLocation = locationId ? allLocations.find((l) => l.id === locationId) : undefined;
    const scope: BusinessContextScope = scopedLocation
      ? { kind: "location", locationId: scopedLocation.id, locationName: scopedLocation.name }
      : { kind: "network" };
    const locationsIncluded = (scopedLocation ? [scopedLocation] : allLocations).map((l) => ({
      id: l.id,
      name: l.name,
      city: l.city,
      type: l.type as string,
      isActive: l.isActive,
    }));

    // Recipes are needed for the products table even when the module itself
    // is off, because a product's cost source depends on whether it has one.
    const recipes = await this.recipesService.findAllForOrganization(user.organizationId, true);
    const recipeByProduct = new Map(recipes.map((r) => [r.productId, r]));

    // The till's «Произвольная сумма» line is kept, not filtered out, even
    // though it is a placeholder rather than a real product: it carries real
    // revenue, and dropping it would leave a product_id in SALES that
    // resolves to nothing here — breaking the referential integrity the whole
    // export depends on. Its `price` column is always 0 and meaningless, so
    // it is reported with no selling price rather than with a false one.
    const contextProducts: BusinessContextProductDto[] = products.map((p) => {
      const recipe = recipeByProduct.get(p.id);
      const resolvedCost = unitCosts.get(p.id) ?? null;
      const isFinished = (p.type as ProductType) === ("FINISHED_GOOD" as ProductType);
      return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          type: p.type,
          unit: p.unit,
          category: p.categoryName,
          // Product.price means different things by type — split into two
          // explicitly named fields rather than exported as one ambiguous
          // "price" the model would have to guess the meaning of.
          sellingPrice: isFinished && !p.isOpenPrice ? p.price : null,
          costPrice: isFinished ? null : p.price,
          unitCost: resolvedCost,
          costSource: recipe?.isActive ? "recipe" : resolvedCost !== null ? "purchase" : "none",
          hasRecipe: recipe !== undefined,
          shelfLifeDays: recipe?.shelfLifeDays ?? null,
          minQuantity: p.minQuantity,
          trackInventory: p.trackInventory,
          isActive: p.isActive,
          consignment:
            p.consignmentSupplierId && p.consignmentPrice !== null
              ? {
                  supplierId: p.consignmentSupplierId,
                  supplierName: p.consignmentSupplierName ?? "Поставщик",
                  unitCost: p.consignmentPrice,
                }
              : null,
      } satisfies BusinessContextProductDto;
    });

    // Counted over the whole catalogue, and said so: SALES reports its own
    // products_without_cost_data over the products actually SOLD in the
    // period, which is a smaller number. Two different denominators, both
    // correct — labelled so they cannot be read as contradicting each other.
    const missingCost = contextProducts.filter((p) => p.costSource === "none");
    if (missingCost.length > 0) {
      warnings.push(
        `В каталоге ${missingCost.length} товар(ов) без себестоимости (нет ни техкарты, ни истории ` +
          `закупок): ${missingCost.slice(0, 8).map((p) => p.name).join(", ")}` +
          `${missingCost.length > 8 ? ", …" : ""}. Их выручка учтена, но в маржу они не входят. ` +
          "В разделе SALES поле products_without_cost_data считает только проданные за период.",
      );
    }
    const missingShelfLife = contextProducts.filter(
      (p) => p.hasRecipe && p.shelfLifeDays === null,
    );
    if (missingShelfLife.length > 0) {
      warnings.push(
        `${missingShelfLife.length} товар(ов) с техкартой, но без указанного срока годности — ` +
          "вопросы про планирование с учётом срока хранения по ним ответить нельзя.",
      );
    }
    if (!organization?.financeInitializedAt) {
      warnings.push(
        "Финансовый учёт не запущен (нет зафиксированных начальных остатков). " +
          "Денежные остатки и балансы могут быть неполными.",
      );
    }

    const context: BusinessContextDto = {
      meta: {
        schemaVersion: BUSINESS_CONTEXT_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        businessName: organization?.name ?? "ArAmir",
        period: {
          from: from.toISOString(),
          to: to.toISOString(),
          days: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1),
        },
        timeZone: BUSINESS_CONTEXT_TIME_ZONE,
        currency: BUSINESS_CONTEXT_CURRENCY,
        exportLevel: level,
        scope,
        locationsIncluded,
        includedModules: modules,
        recordCounts: {},
        warnings,
        limitations,
      },
      locations: locationsIncluded,
      products: contextProducts,
      recipes: null,
      sales: null,
      production: null,
      inventory: null,
      purchases: null,
      writeOffs: null,
      finance: null,
      customers: null,
      personnel: null,
      insights: null,
    };

    // ── Recipes ────────────────────────────────────────────────────────
    if (has("recipes")) {
      context.recipes = recipes.map((r) => {
        const effectiveYield =
          r.lossPercent !== null && r.lossPercent > 0
            ? r.yieldQuantity * (1 - r.lossPercent / 100)
            : r.yieldQuantity;
        return {
          recipeId: r.id,
          productId: r.productId,
          productName: r.productName,
          yieldQuantity: r.yieldQuantity,
          lossPercent: r.lossPercent,
          effectiveYield: Number(effectiveYield.toFixed(3)),
          pieceWeightG: r.pieceWeightG,
          shelfLifeDays: r.shelfLifeDays,
          totalIngredientCost: r.totalIngredientCost,
          unitCost: r.unitCost,
          isActive: r.isActive,
          ingredients: r.items.map((i) => {
            const cost = unitCosts.get(i.ingredientProductId) ?? null;
            return {
              productId: i.ingredientProductId,
              name: i.ingredientProductName,
              quantity: i.quantity,
              unit: i.unit as Unit,
              unitCost: cost,
              lineCost: cost === null ? null : Number((cost * i.quantity).toFixed(2)),
            };
          }),
        } satisfies BusinessContextRecipeDto;
      });
      context.meta.recordCounts.recipes = context.recipes.length;
    }

    // ── Sales ──────────────────────────────────────────────────────────
    if (has("sales")) {
      const [report, profitability, dynamics] = await Promise.all([
        this.salesService.report(user, from, to, locationId),
        this.salesService.productProfitability(user, from, to, locationId),
        this.salesService.dynamics(user, from, to, locationId),
      ]);

      // The only unbounded part of the export. Trimmed to the most RECENT
      // days rather than the first ones: a question about a long period is
      // almost always really a question about how it is going now.
      const limit = detail.dailyPoints;
      const trimmed =
        dynamics.points.length > limit ? dynamics.points.slice(-limit) : dynamics.points;
      if (!detail.hourlyBreakdown) {
        warnings.push(
          "Уровень «Быстрый»: разбивка выручки по часам не включена. Для вопросов про " +
            "график работы и время выпечки выберите «Основной».",
        );
      }
      if (trimmed.length < dynamics.points.length) {
        warnings.push(
          `Разбивка по дням сокращена до последних ${trimmed.length} из ${dynamics.points.length} ` +
            "дней периода — итоги, разбивки по дням недели и по часам считаются по ВСЕМУ периоду. " +
            "Для полной ежедневной детализации выберите уровень «Полный».",
        );
      }

      context.sales = {
        totalRevenue: report.totalRevenue,
        salesCount: report.totalCount,
        averageTicket: dynamics.averageTicket,
        totalCost: profitability.totalCost,
        totalMargin: profitability.totalMargin,
        totalMarginPercent: profitability.totalMarginPercent,
        revenueWithoutCostData: profitability.revenueWithoutCostData,
        productsWithoutCostData: profitability.productsWithoutCostData,
        markdownLoss: report.markdownLoss,
        markdownQuantity: report.markdownQuantity,
        byProduct: profitability.rows,
        byLocation: report.byLocation.map((l) => ({
          locationId: l.locationId,
          locationName: l.locationName,
          revenue: l.revenue,
          salesCount: l.count,
          averageTicket: l.count > 0 ? Number((l.revenue / l.count).toFixed(2)) : null,
        })),
        dynamics: {
          ...dynamics,
          points: trimmed,
          // Hour-of-day is 24 rows that only matter to a question about
          // staffing or baking times — not what a quick context is for.
          byHour: detail.hourlyBreakdown ? dynamics.byHour : [],
        },
      };
      context.meta.recordCounts.sales = report.totalCount;
      context.meta.recordCounts.productsSold = profitability.rows.length;
    }

    // ── Production ─────────────────────────────────────────────────────
    if (has("production")) {
      context.production = await this.productionService.summaryByProduct(user, from, to, locationId);
      context.meta.recordCounts.productionBatches = context.production.batchesTotal;
    }

    // ── Inventory ──────────────────────────────────────────────────────
    if (has("inventory")) {
      const [stock, movements, valuation] = await Promise.all([
        this.inventoryService.getStockLevels(user, locationId),
        this.inventoryService.movementsSummary(user, from, to, locationId),
        this.financeService.getInventoryValuation(user.organizationId),
      ]);

      // Valuation has no location filter of its own, and silently reporting a
      // network figure inside a single-point export is exactly the mixing the
      // scope rule forbids — so it is withheld and said out loud instead.
      const valuationApplies = scope.kind === "network";
      if (!valuationApplies) {
        warnings.push(
          "Оценка склада в деньгах (stock_valuation) считается только по всей сети и для " +
            "выбранной точки не приводится — чтобы не смешивать данные сети с данными точки.",
        );
      }

      context.inventory = {
        currentStock: stock.map((s) => ({
          productId: s.productId,
          productName: s.productName,
          locationId: s.locationId,
          locationName: s.locationName,
          unit: s.unit,
          quantity: s.quantity,
          minQuantity: s.minQuantity,
          isLow: s.isLow,
        })),
        lowStockCount: stock.filter((s) => s.isLow).length,
        movementsByType: movements,
        valuationTotal: valuationApplies ? valuation.totalValue : null,
        valuationUnknownLines: valuationApplies ? valuation.unknownValueLineItems : 0,
      };
      context.meta.recordCounts.stockLines = stock.length;
    }

    // ── Purchases ──────────────────────────────────────────────────────
    if (has("purchases")) {
      const purchases = await this.procurementService.purchasesSummary(user, from, to, locationId);
      if (purchases.byProduct.length > detail.purchaseProductRows) {
        warnings.push(
          `Уровень «Быстрый»: в закупках показаны ${detail.purchaseProductRows} позиций из ` +
            `${purchases.byProduct.length} (самые крупные по сумме). Итоги — по всем.`,
        );
      }
      context.purchases = {
        ...purchases,
        byProduct: purchases.byProduct.slice(0, detail.purchaseProductRows),
      };
      context.meta.recordCounts.purchaseOrders = context.purchases.ordersCount;
      context.meta.recordCounts.supplierInvoices = context.purchases.invoicesCount;
    }

    // ── Write-offs ─────────────────────────────────────────────────────
    if (has("writeOffs")) {
      context.writeOffs = await this.qualityService.getSummary(user, from, to, locationId);
      context.meta.recordCounts.writeOffs = context.writeOffs.totalMovements;
    }

    // ── Finance ────────────────────────────────────────────────────────
    if (has("finance")) {
      const [pnl, breakEven, receivable, payable, consignmentOwed, consignmentBalances] =
        await Promise.all([
          this.financeService.getProfitAndLoss(user.organizationId, from, to, locationId),
          this.financeService.getBreakEven(user.organizationId, from, to, locationId),
          this.financeService.getAccountsReceivable(user.organizationId),
          this.financeService.getAccountsPayable(user.organizationId),
          this.financeService.getConsignmentOwed(user.organizationId),
          this.consignmentService.balances(user.organizationId),
        ]);

      // Cash flow is organization-wide by construction: money sits in
      // accounts, and an account is not owned by a point of sale. Withheld
      // rather than misattributed when one point was asked for.
      const cashFlowApplies = scope.kind === "network";
      if (!cashFlowApplies) {
        warnings.push(
          "ДДС (движение денежных средств), дебиторская и кредиторская задолженность " +
            "ведутся по организации в целом, а не по точкам. В экспорте по одной точке " +
            "ДДС не приводится, а задолженности относятся ко всей сети.",
        );
      }

      context.finance = {
        pnl,
        breakEven,
        cashFlow: cashFlowApplies ? await this.cashFlowFor(user.organizationId, from, to, detail) : null,
        accountsReceivable: receivable,
        accountsPayable: payable,
        consignmentOwed,
        consignmentBalances,
      };
    }

    // ── Customers ──────────────────────────────────────────────────────
    if (has("customers")) {
      const customers = await this.customersService.revenueByCustomer(
        user.organizationId,
        from,
        to,
        locationId,
      );
      if (customers.byCustomer.length > detail.customerRows) {
        warnings.push(
          `Уровень «Быстрый»: показаны ${detail.customerRows} клиентов из ` +
            `${customers.byCustomer.length} (самые крупные по выручке). Итоги — по всем.`,
        );
      }
      context.customers = {
        ...customers,
        byCustomer: customers.byCustomer.slice(0, detail.customerRows),
      };
      context.meta.recordCounts.customersWithSales = context.customers.byCustomer.length;
    }

    // ── Personnel ──────────────────────────────────────────────────────
    if (has("personnel")) {
      const kpi = await this.hrService.getKpi(user, from, to, locationId);
      context.personnel = kpi.employees;
      context.meta.recordCounts.employeesWithActivity = kpi.employees.length;
    }

    // ── Insights ───────────────────────────────────────────────────────
    if (has("insights")) {
      // The Stage-1 rule engine's own output, reused rather than reimplemented
      // — every line of it is already a computed fact with no LLM involved,
      // which is exactly what this export is supposed to carry.
      const insights = await this.aiAnalyticsService.getInsights(user);
      context.insights = insights.insights;
      context.meta.recordCounts.insights = insights.insights.length;
      if (scope.kind === "location") {
        warnings.push(
          "AI-инсайты рассчитываются по всей сети и по своему собственному окну " +
            "(последние дни), а не по выбранным периоду и точке.",
        );
      }
    }

    context.meta.recordCounts.products = contextProducts.length;
    context.meta.recordCounts.locations = locationsIncluded.length;

    return context;
  }
}
