import { Injectable } from "@nestjs/common";
import { ProductionBatchStatus as PrismaProductionBatchStatus, InvoiceStatus as PrismaInvoiceStatus } from "@prisma/client";
import {
  AiConfidence,
  AiExecutiveSummaryDto,
  AiInsightCategory,
  AiInsightDto,
  AiInsightPriority,
  AI_INSIGHT_PRIORITY_WEIGHT,
  AiInsightsResponseDto,
  AiLocationDeviationDto,
  AiLocationDeviationResponseDto,
  DismissAiInsightResponseDto,
  CashMovementType,
  CASH_MOVEMENT_INFLOW_TYPES,
  WRITE_OFF_REASON_LABELS_RU,
  LocationType,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { resolveLocationScope } from "../common/location-scope";
import { currentAndPreviousPeriod, deltaPct, PeriodRange } from "../common/period-range";
import { FinanceService } from "../finance/finance.service";
import { CashAccountsService } from "../finance/cash-accounts.service";
import { SalesService } from "../sales/sales.service";
import { QualityService } from "../quality/quality.service";
import { LocationsService } from "../locations/locations.service";
import { RecipesService } from "../recipes/recipes.service";

// ── Formatting helpers — mirror apps/web/src/lib/format.ts exactly so a
// generated fact reads identically to the number it would show next to
// anywhere else in the app. ─────────────────────────────────────────────
const moneyFormatter = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 });
function fmtMoney(v: number): string {
  return moneyFormatter.format(v);
}
function fmtQty(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Standard Russian numeral-noun agreement (1 неделю / 2 недели / 5 недель).
function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
const weeksWordRu = (n: number) => ruPlural(n, "неделю", "недели", "недель");
const daysWordRu = (n: number) => ruPlural(n, "день", "дня", "дней");
const timesWordRu = (n: number) => ruPlural(n, "раз", "раза", "раз");

const WEEKDAY_LOCATIVE_RU = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];

function weekBucketKey(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function dayBucketKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// A LOW-confidence insight never outranks a LOW priority one, and MEDIUM
// confidence can't carry a CRITICAL claim — this is the one central place
// that enforces "confidence caps priority", applied once in getInsights()
// rather than repeated by hand in every generator below.
function capPriorityByConfidence(priority: AiInsightPriority, confidence: AiConfidence): AiInsightPriority {
  if (confidence === AiConfidence.HIGH) return priority;
  if (confidence === AiConfidence.MEDIUM) {
    return priority === AiInsightPriority.CRITICAL ? AiInsightPriority.HIGH : priority;
  }
  return AiInsightPriority.LOW;
}

// AI-центр, Этап 1 — deterministic analytics + statistical forecasting +
// anomaly detection. No LLM anywhere in this file: every `facts`/`hypothesis`
// string is a template over numbers already computed here. Reuses existing
// domain services wherever one already computes the number needed
// (FinanceService, SalesService, QualityService, LocationsService,
// RecipesService) and only queries Prisma directly for the handful of
// cross-module/time-series aggregations nothing else in the codebase
// computes yet (see each private method's comment).
@Injectable()
export class AiAnalyticsService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private cashAccountsService: CashAccountsService,
    private salesService: SalesService,
    private qualityService: QualityService,
    private locationsService: LocationsService,
    private recipesService: RecipesService,
  ) {}

  // ── Сводка ─────────────────────────────────────────────────────────

  async getExecutiveSummary(user: AuthenticatedUser, days = 7): Promise<AiExecutiveSummaryDto> {
    const locationId = resolveLocationScope(user);
    const { current, previous } = currentAndPreviousPeriod(days);

    const [pnlCurrent, pnlPrevious, ar, ap, accounts] = await Promise.all([
      this.financeService.getProfitAndLoss(user.organizationId, current.from, current.to, locationId),
      this.financeService.getProfitAndLoss(user.organizationId, previous.from, previous.to, locationId),
      this.financeService.getAccountsReceivable(user.organizationId),
      this.financeService.getAccountsPayable(user.organizationId),
      this.cashAccountsService.findAll(user.organizationId),
    ]);

    const cashTotal = accounts.filter((a) => a.isActive).reduce((sum, a) => sum + a.currentBalance, 0);
    const revenueConfidence = pnlPrevious.revenue > 0 ? AiConfidence.HIGH : AiConfidence.LOW;
    // Margin is a percentage already — comparing it to the previous period
    // is a percentage-POINT difference, never a "percent change of a
    // percent" (that second reading is a classic, misleading mistake).
    const marginDeltaPoints =
      pnlCurrent.grossMarginPercent !== null && pnlPrevious.grossMarginPercent !== null
        ? pnlCurrent.grossMarginPercent - pnlPrevious.grossMarginPercent
        : null;

    return {
      from: current.from.toISOString(),
      to: current.to.toISOString(),
      metrics: [
        {
          key: "revenue",
          label: "Выручка",
          value: pnlCurrent.revenue,
          unit: "money",
          deltaPct: deltaPct(pnlCurrent.revenue, pnlPrevious.revenue),
          confidence: revenueConfidence,
        },
        {
          key: "margin",
          label: "Валовая маржа",
          value: pnlCurrent.grossMarginPercent ?? 0,
          unit: "percent",
          deltaPct: marginDeltaPoints,
          confidence: pnlCurrent.grossMarginPercent !== null ? revenueConfidence : AiConfidence.LOW,
        },
        { key: "cash", label: "Денежные средства", value: cashTotal, unit: "money", deltaPct: null, confidence: AiConfidence.HIGH },
        { key: "receivables", label: "Дебиторская задолженность", value: ar, unit: "money", deltaPct: null, confidence: AiConfidence.HIGH },
        { key: "payables", label: "Кредиторская задолженность", value: ap, unit: "money", deltaPct: null, confidence: AiConfidence.HIGH },
      ],
    };
  }

  // ── Сравнение точек ────────────────────────────────────────────────
  // Reuses LocationsService.findComparison() (already an aggregated
  // per-location DTO) and adds only the deviation-from-median statistics
  // on top — no re-querying of Sale/StockLevel/Expense/User.

  async computeLocationDeviations(user: AuthenticatedUser, days = 7): Promise<AiLocationDeviationResponseDto> {
    const { current } = currentAndPreviousPeriod(days);
    const allComparisons = await this.locationsService.findComparison(user.organizationId, current.from, current.to);
    // Only retail points sell — comparing a warehouse's or production
    // site's ~0 revenue against a store's is a category error, not a real
    // deviation, and it drags the median toward zero enough to produce
    // nonsensical percentages (a real store showing "6000% above median").
    const comparisons = allComparisons.filter((c) => c.type === LocationType.STORE);

    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const stdev = (values: number[]): number => {
      if (values.length === 0) return 0;
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      return Math.sqrt(variance);
    };

    const revenues = comparisons.map((c) => c.revenue);
    const tickets = comparisons.map((c) => c.averageTicket);
    const revenueMedian = median(revenues);
    const ticketMedian = median(tickets);
    const revenueStdev = stdev(revenues);

    const locations: AiLocationDeviationDto[] = comparisons.map((c) => {
      const revenueDeviationPct = revenueMedian > 0 ? ((c.revenue - revenueMedian) / revenueMedian) * 100 : 0;
      const averageTicketDeviationPct = ticketMedian > 0 ? ((c.averageTicket - ticketMedian) / ticketMedian) * 100 : 0;
      // "z-score-ish": a plain standard-deviation distance, not a claim of
      // statistical normality — good enough to rank a handful of locations,
      // not meant to be rigorous.
      const z = revenueStdev > 0 ? (c.revenue - revenueMedian) / revenueStdev : 0;
      const confidence: AiConfidence = c.salesCount >= 10 ? AiConfidence.HIGH : c.salesCount >= 3 ? AiConfidence.MEDIUM : AiConfidence.LOW;

      return {
        locationId: c.id,
        locationName: c.name,
        revenue: c.revenue,
        averageTicket: c.averageTicket,
        expenses: c.expenses,
        lowStockCount: c.lowStockCount,
        activeStaffCount: c.activeStaffCount,
        revenueDeviationPct,
        averageTicketDeviationPct,
        isOutlier: Math.abs(z) >= 1.5,
        confidence,
      };
    });

    return {
      from: current.from.toISOString(),
      to: current.to.toISOString(),
      networkMedianRevenue: revenueMedian,
      networkMedianAverageTicket: ticketMedian,
      locations,
    };
  }

  // ── Приоритеты (единая лента) ──────────────────────────────────────

  async getInsights(user: AuthenticatedUser): Promise<AiInsightsResponseDto> {
    const groups = await Promise.all([
      this.computeMarginDropInsights(user),
      this.computeWriteOffRateInsights(user),
      this.computeWeekdayAnomalyInsights(user),
      this.computeLocationDeviationInsights(user),
      this.computeReceivablesRiskInsights(user),
      this.computeNewInvoiceGrowthInsights(user),
      this.computeCashRunwayInsights(user),
      this.computeIdleProductInsights(user),
    ]);

    const all = groups
      .flat()
      .map((insight) => ({ ...insight, priority: capPriorityByConfidence(insight.priority, insight.confidence) }));

    const dismissed = await this.prisma.notificationDismissal.findMany({ where: { userId: user.id } });
    const dismissedKeys = new Set(dismissed.map((d) => d.key));
    const visible = all.filter((i) => !dismissedKeys.has(i.key));

    visible.sort((a, b) => {
      const weightDiff = AI_INSIGHT_PRIORITY_WEIGHT[b.priority] - AI_INSIGHT_PRIORITY_WEIGHT[a.priority];
      return weightDiff !== 0 ? weightDiff : b.createdAt.localeCompare(a.createdAt);
    });

    return { insights: visible };
  }

  async dismiss(user: AuthenticatedUser, key: string): Promise<DismissAiInsightResponseDto> {
    await this.prisma.notificationDismissal.upsert({
      where: { userId_key: { userId: user.id, key } },
      create: { organizationId: user.organizationId, userId: user.id, key },
      update: {},
    });
    return { dismissed: true };
  }

  async dismissAll(user: AuthenticatedUser): Promise<DismissAiInsightResponseDto> {
    const { insights } = await this.getInsights(user);
    if (insights.length > 0) {
      await this.prisma.notificationDismissal.createMany({
        data: insights.map((i) => ({ organizationId: user.organizationId, userId: user.id, key: i.key })),
        skipDuplicates: true,
      });
    }
    return { dismissed: true };
  }

  // ── 1. Маржа по рецептуре ─────────────────────────────────────────
  // Current margin comes straight from RecipesService (same calc the
  // Production module already shows). The previous-period margin is
  // reconstructed from historical PurchaseOrderItem prices — nothing else
  // in the codebase tracks ingredient cost over time.

  private async computeMarginDropInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const recipes = await this.recipesService.findAllForOrganization(user.organizationId, false);
    const activeRecipes = recipes.filter((r) => r.isActive && r.items.length > 0 && r.marginPercent !== null);
    if (activeRecipes.length === 0) return [];

    const { previous } = currentAndPreviousPeriod(21);
    const ingredientIds = [...new Set(activeRecipes.flatMap((r) => r.items.map((i) => i.ingredientProductId)))];

    const [purchaseItems, ingredientProducts] = await Promise.all([
      this.prisma.purchaseOrderItem.findMany({
        where: { productId: { in: ingredientIds }, purchaseOrder: { organizationId: user.organizationId, orderedAt: { gte: previous.from, lte: previous.to } } },
        select: { productId: true, quantity: true, unitCost: true },
      }),
      this.prisma.product.findMany({ where: { id: { in: ingredientIds } }, select: { id: true, name: true, price: true } }),
    ]);

    const priceAgg = new Map<string, { cost: number; qty: number }>();
    for (const item of purchaseItems) {
      const entry = priceAgg.get(item.productId) ?? { cost: 0, qty: 0 };
      entry.cost += item.unitCost.toNumber() * item.quantity.toNumber();
      entry.qty += item.quantity.toNumber();
      priceAgg.set(item.productId, entry);
    }
    const currentPriceByIngredient = new Map(ingredientProducts.map((p) => [p.id, { name: p.name, price: p.price.toNumber() }]));

    const insights: AiInsightDto[] = [];
    for (const recipe of activeRecipes) {
      if (recipe.items.some((i) => !priceAgg.has(i.ingredientProductId))) continue; // can't reconstruct a reliable previous cost for every ingredient

      const previousUnitCost =
        recipe.items.reduce((sum, item) => {
          const agg = priceAgg.get(item.ingredientProductId)!;
          const avgPrice = agg.qty > 0 ? agg.cost / agg.qty : 0;
          return sum + item.quantity * avgPrice;
        }, 0) / recipe.yieldQuantity;

      if (recipe.productPrice <= 0) continue;
      const previousMarginPercent = ((recipe.productPrice - previousUnitCost) / recipe.productPrice) * 100;
      const marginDeltaPoints = recipe.marginPercent! - previousMarginPercent;
      if (marginDeltaPoints >= -5) continue; // only a genuine drop of ≥5pp is actionable

      let topIngredient: { name: string; deltaPct: number } | null = null;
      for (const item of recipe.items) {
        const agg = priceAgg.get(item.ingredientProductId)!;
        const avgPastPrice = agg.qty > 0 ? agg.cost / agg.qty : 0;
        const current = currentPriceByIngredient.get(item.ingredientProductId);
        if (!current || avgPastPrice <= 0) continue;
        const ingredientDeltaPct = ((current.price - avgPastPrice) / avgPastPrice) * 100;
        if (ingredientDeltaPct > 0 && (!topIngredient || ingredientDeltaPct > topIngredient.deltaPct)) {
          topIngredient = { name: current.name, deltaPct: ingredientDeltaPct };
        }
      }

      insights.push({
        key: `ai:margin-drop:${recipe.id}:${weekBucketKey()}`,
        category: AiInsightCategory.MARGIN,
        priority: marginDeltaPoints <= -15 ? AiInsightPriority.HIGH : AiInsightPriority.MEDIUM,
        confidence: AiConfidence.HIGH,
        title: `Маржа «${recipe.productName}» снижается`,
        facts: [
          `Маржа «${recipe.productName}» упала с ${previousMarginPercent.toFixed(0)}% до ${recipe.marginPercent!.toFixed(0)}% за последние 3 недели.`,
          `Себестоимость единицы выросла с ${fmtMoney(previousUnitCost)} до ${fmtMoney(recipe.unitCost)}.`,
        ],
        hypothesis: topIngredient
          ? `Совпадает по времени с ростом цены «${topIngredient.name}» на ${topIngredient.deltaPct.toFixed(0)}% — вероятная, но не единственно возможная причина.`
          : null,
        metrics: [
          { label: "Маржа сейчас", value: recipe.marginPercent!, unit: "percent" },
          { label: "Маржа 3 недели назад", value: previousMarginPercent, unit: "percent" },
        ],
        locationId: null,
        locationName: null,
        link: "/production",
        createdAt: new Date().toISOString(),
      });
    }
    return insights;
  }

  // ── 2. Рост доли списаний ─────────────────────────────────────────
  // Pure reuse: QualityService.getSummary() for write-off value,
  // SalesService.report() for revenue — the ratio itself doesn't exist
  // anywhere yet.

  private async computeWriteOffRateInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const locationId = resolveLocationScope(user);
    const { current, previous } = currentAndPreviousPeriod(7);

    const [qCurrent, qPrevious, revCurrent, revPrevious] = await Promise.all([
      this.qualityService.getSummary(user, current.from, current.to, locationId),
      this.qualityService.getSummary(user, previous.from, previous.to, locationId),
      this.salesService.report(user, current.from, current.to, locationId),
      this.salesService.report(user, previous.from, previous.to, locationId),
    ]);

    if (revCurrent.totalRevenue <= 0 || revPrevious.totalRevenue <= 0) return [];
    const rateCurrent = (qCurrent.totalValue / revCurrent.totalRevenue) * 100;
    const ratePrevious = (qPrevious.totalValue / revPrevious.totalRevenue) * 100;
    if (ratePrevious <= 0) return [];

    const growthPct = ((rateCurrent - ratePrevious) / ratePrevious) * 100;
    if (growthPct < 30) return [];

    const topReason = qCurrent.byReason[0];
    const topProduct = qCurrent.byProduct[0];

    return [
      {
        key: `ai:writeoff-rate:${locationId ?? "network"}:${weekBucketKey()}`,
        category: AiInsightCategory.WRITE_OFF,
        priority: growthPct >= 50 ? AiInsightPriority.HIGH : AiInsightPriority.MEDIUM,
        confidence: AiConfidence.HIGH,
        title: "Доля списаний от выручки выросла",
        facts: [
          `Доля списаний от выручки выросла с ${ratePrevious.toFixed(1)}% до ${rateCurrent.toFixed(1)}% за неделю.`,
          ...(topReason ? [`Основная причина: «${WRITE_OFF_REASON_LABELS_RU[topReason.reason]}» — ${fmtMoney(topReason.value)}.`] : []),
          ...(topProduct ? [`Больше всего списано: «${topProduct.productName}» (${fmtMoney(topProduct.value)}).`] : []),
        ],
        hypothesis: null,
        metrics: [
          { label: "Доля списаний сейчас", value: rateCurrent, unit: "percent" },
          { label: "Доля списаний неделю назад", value: ratePrevious, unit: "percent" },
        ],
        locationId: locationId ?? null,
        locationName: null,
        link: "/quality",
        createdAt: new Date().toISOString(),
      },
    ];
  }

  // ── 3. Аномалия продаж по дню недели ──────────────────────────────
  // New: nothing in the codebase groups sales by weekday. Baseline =
  // average of the same weekday over the last up-to-8 comparable weeks
  // (never "today vs yesterday" — a bakery's real seasonality is weekly).

  private async computeWeekdayAnomalyInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const requestedLocationId = resolveLocationScope(user);
    const now = new Date();
    const lookbackStart = new Date(now);
    lookbackStart.setDate(lookbackStart.getDate() - 56);

    const sales = await this.prisma.sale.findMany({
      where: { organizationId: user.organizationId, soldAt: { gte: lookbackStart, lte: now }, ...(requestedLocationId ? { locationId: requestedLocationId } : {}) },
      select: { soldAt: true, totalAmount: true, locationId: true, location: { select: { name: true } } },
    });

    const todayWeekday = now.getDay();
    const byLocation = new Map<string, { name: string; byWeek: Map<string, number>; today: number }>();

    for (const sale of sales) {
      if (sale.soldAt.getDay() !== todayWeekday) continue;
      const entry = byLocation.get(sale.locationId) ?? { name: sale.location.name, byWeek: new Map<string, number>(), today: 0 };
      if (sale.soldAt.toDateString() === now.toDateString()) {
        entry.today += sale.totalAmount.toNumber();
      } else {
        const wk = weekBucketKey(sale.soldAt);
        entry.byWeek.set(wk, (entry.byWeek.get(wk) ?? 0) + sale.totalAmount.toNumber());
      }
      byLocation.set(sale.locationId, entry);
    }

    const insights: AiInsightDto[] = [];
    for (const [locationId, entry] of byLocation) {
      const weeks = [...entry.byWeek.values()];
      if (weeks.length < 2) continue; // no baseline possible yet
      const baseline = weeks.reduce((s, v) => s + v, 0) / weeks.length;
      if (baseline <= 0) continue;

      const deviationPct = ((entry.today - baseline) / baseline) * 100;
      if (Math.abs(deviationPct) < 20) continue;

      const confidence = weeks.length >= 4 ? AiConfidence.HIGH : AiConfidence.MEDIUM;
      const direction = deviationPct < 0 ? "ниже" : "выше";

      insights.push({
        key: `ai:weekday-anomaly:${locationId}:${dayBucketKey(now)}`,
        category: AiInsightCategory.SALES_ANOMALY,
        priority: Math.abs(deviationPct) >= 35 ? AiInsightPriority.HIGH : AiInsightPriority.MEDIUM,
        confidence,
        title: `Продажи ${WEEKDAY_LOCATIVE_RU[todayWeekday]} отклоняются от обычного уровня`,
        facts: [
          `Продажи сегодня на точке «${entry.name}» на ${Math.abs(deviationPct).toFixed(0)}% ${direction} обычного (${fmtMoney(entry.today)} против среднего ${fmtMoney(baseline)} за последние ${weeks.length} ${weeksWordRu(weeks.length)}).`,
        ],
        hypothesis: null,
        metrics: [
          { label: "Продажи сегодня", value: entry.today, unit: "money" },
          { label: "Обычный уровень по этому дню", value: baseline, unit: "money" },
        ],
        locationId,
        locationName: entry.name,
        link: "/sales",
        createdAt: new Date().toISOString(),
      });
    }
    return insights;
  }

  // ── 4. Точка отклоняется от сети ──────────────────────────────────

  private async computeLocationDeviationInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const result = await this.computeLocationDeviations(user, 7);
    const insights: AiInsightDto[] = [];

    for (const loc of result.locations) {
      if (!loc.isOutlier || loc.confidence === AiConfidence.LOW) continue;
      const direction = loc.revenueDeviationPct < 0 ? "ниже" : "выше";

      insights.push({
        key: `ai:location-deviation:${loc.locationId}:${weekBucketKey()}`,
        category: AiInsightCategory.LOCATION_DEVIATION,
        priority: Math.abs(loc.revenueDeviationPct) >= 40 ? AiInsightPriority.HIGH : AiInsightPriority.MEDIUM,
        confidence: loc.confidence,
        title: `Точка «${loc.locationName}» отклоняется от сети`,
        facts: [
          `Выручка точки «${loc.locationName}» — ${fmtMoney(loc.revenue)}, это на ${Math.abs(loc.revenueDeviationPct).toFixed(0)}% ${direction} медианы по сети (${fmtMoney(result.networkMedianRevenue)}).`,
        ],
        hypothesis: null,
        metrics: [
          { label: "Выручка точки", value: loc.revenue, unit: "money" },
          { label: "Медиана по сети", value: result.networkMedianRevenue, unit: "money" },
        ],
        locationId: loc.locationId,
        locationName: loc.locationName,
        link: "/network",
        createdAt: new Date().toISOString(),
      });
    }
    return insights;
  }

  // ── 5. Риск дебиторки ──────────────────────────────────────────────
  // New: reads CustomerPayment history directly from CashMovement (the
  // ledger built this session) to compute each customer's normal payment
  // interval — nothing else computes this today.

  private async computeReceivablesRiskInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const [customers, payments] = await Promise.all([
      this.prisma.customer.findMany({ where: { organizationId: user.organizationId, isActive: true } }),
      this.prisma.cashMovement.findMany({
        where: { organizationId: user.organizationId, type: CashMovementType.CUSTOMER_PAYMENT, customerId: { not: null } },
        orderBy: { occurredAt: "asc" },
        select: { customerId: true, occurredAt: true },
      }),
    ]);
    if (customers.length === 0) return [];

    const paymentsByCustomer = new Map<string, Date[]>();
    for (const p of payments) {
      if (!p.customerId) continue;
      const arr = paymentsByCustomer.get(p.customerId) ?? [];
      arr.push(p.occurredAt);
      paymentsByCustomer.set(p.customerId, arr);
    }

    const balances = await this.prisma.sale.groupBy({
      by: ["customerId"],
      where: { organizationId: user.organizationId, customerId: { in: customers.map((c) => c.id) } },
      _sum: { totalAmount: true, amountPaid: true },
    });
    const balanceByCustomer = new Map(
      balances.map((b) => [b.customerId as string, (b._sum.totalAmount?.toNumber() ?? 0) - (b._sum.amountPaid?.toNumber() ?? 0)]),
    );

    const now = new Date();
    const insights: AiInsightDto[] = [];

    for (const customer of customers) {
      const balance = balanceByCustomer.get(customer.id) ?? 0;
      if (balance <= 0) continue;
      const dates = paymentsByCustomer.get(customer.id) ?? [];
      if (dates.length < 2) continue; // no interval baseline

      const intervals: number[] = [];
      for (let i = 1; i < dates.length; i++) intervals.push((dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000);
      const avgIntervalDays = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      if (avgIntervalDays <= 0) continue;

      const daysSinceLastPayment = (now.getTime() - dates[dates.length - 1].getTime()) / 86_400_000;
      const ratio = daysSinceLastPayment / avgIntervalDays;
      if (ratio < 2) continue;

      insights.push({
        key: `ai:receivables-risk:${customer.id}:${weekBucketKey()}`,
        category: AiInsightCategory.RECEIVABLES,
        priority: ratio >= 3 ? AiInsightPriority.HIGH : AiInsightPriority.MEDIUM,
        confidence: intervals.length >= 3 ? AiConfidence.HIGH : AiConfidence.MEDIUM,
        title: `«${customer.name}» задерживает оплату`,
        facts: [
          `«${customer.name}» не производил оплату ${Math.round(daysSinceLastPayment)} ${daysWordRu(Math.round(daysSinceLastPayment))} при обычном интервале ~${Math.round(avgIntervalDays)} ${daysWordRu(Math.round(avgIntervalDays))}.`,
          `Текущий долг — ${fmtMoney(balance)}.`,
        ],
        hypothesis: null,
        metrics: [
          { label: "Дней без оплаты", value: Math.round(daysSinceLastPayment), unit: "days" },
          { label: "Обычный интервал", value: Math.round(avgIntervalDays), unit: "days" },
          { label: "Текущий долг", value: balance, unit: "money" },
        ],
        locationId: null,
        locationName: null,
        link: "/customers",
        createdAt: new Date().toISOString(),
      });
    }
    return insights;
  }

  // ── 6. Рост объёма новых счетов от поставщиков ────────────────────
  // Deliberately NOT "AP balance delta" — FinanceService.getAccountsPayable
  // only ever computes the CURRENT unpaid balance, and reconstructing a
  // past point-in-time AP balance would need full event-sourcing replay of
  // Invoice/CashMovement history. Comparing new-invoice volume period over
  // period is the honestly-computable proxy for "кредиторка растёт".

  private async computeNewInvoiceGrowthInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const locationId = resolveLocationScope(user);
    const { current, previous } = currentAndPreviousPeriod(30);

    const whereFor = (range: PeriodRange) => ({
      organizationId: user.organizationId,
      status: { not: PrismaInvoiceStatus.CANCELLED },
      issuedAt: { gte: range.from, lte: range.to },
      ...(locationId ? { locationId } : {}),
    });

    const [currentInvoices, previousInvoices] = await Promise.all([
      this.prisma.invoice.findMany({ where: whereFor(current), include: { supplier: true } }),
      this.prisma.invoice.findMany({ where: whereFor(previous) }),
    ]);

    const currentTotal = currentInvoices.reduce((s, i) => s + i.totalCost.toNumber(), 0);
    const previousTotal = previousInvoices.reduce((s, i) => s + i.totalCost.toNumber(), 0);
    if (previousTotal <= 0) return [];

    const growthPct = ((currentTotal - previousTotal) / previousTotal) * 100;
    if (growthPct < 25) return [];

    const bySupplier = new Map<string, number>();
    for (const inv of currentInvoices) bySupplier.set(inv.supplier.name, (bySupplier.get(inv.supplier.name) ?? 0) + inv.totalCost.toNumber());
    const topSupplier = [...bySupplier.entries()].sort((a, b) => b[1] - a[1])[0];

    return [
      {
        key: `ai:new-invoices:${locationId ?? "network"}:${weekBucketKey()}`,
        category: AiInsightCategory.PAYABLES,
        priority: growthPct >= 50 ? AiInsightPriority.HIGH : AiInsightPriority.MEDIUM,
        confidence: AiConfidence.HIGH,
        title: "Объём новых счетов от поставщиков вырос",
        facts: [
          `Сумма новых счетов от поставщиков за последние 30 дней — ${fmtMoney(currentTotal)}, это на ${growthPct.toFixed(0)}% больше, чем за предыдущие 30 дней (${fmtMoney(previousTotal)}).`,
          ...(topSupplier ? [`Основной вклад — поставщик «${topSupplier[0]}» (${fmtMoney(topSupplier[1])}).`] : []),
        ],
        hypothesis: null,
        metrics: [
          { label: "Счета за 30 дней", value: currentTotal, unit: "money" },
          { label: "Счета за предыдущие 30 дней", value: previousTotal, unit: "money" },
        ],
        locationId: locationId ?? null,
        locationName: null,
        link: "/procurement",
        createdAt: new Date().toISOString(),
      },
    ];
  }

  // ── 7. Кассовый запас хода ─────────────────────────────────────────

  private async computeCashRunwayInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const accounts = (await this.cashAccountsService.findAll(user.organizationId)).filter((a) => a.isActive);
    if (accounts.length === 0) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);

    const movements = await this.prisma.cashMovement.findMany({
      where: { organizationId: user.organizationId, accountId: { in: accounts.map((a) => a.id) }, occurredAt: { gte: cutoff } },
      select: { accountId: true, type: true, amount: true },
    });

    const outflowByAccount = new Map<string, number>();
    for (const m of movements) {
      const amount = m.amount.toNumber();
      const type = m.type as CashMovementType;
      const isInflow = type === CashMovementType.ADJUSTMENT ? amount >= 0 : CASH_MOVEMENT_INFLOW_TYPES.includes(type);
      if (isInflow) continue;
      outflowByAccount.set(m.accountId, (outflowByAccount.get(m.accountId) ?? 0) + Math.abs(amount));
    }

    const insights: AiInsightDto[] = [];
    for (const account of accounts) {
      const totalOutflow = outflowByAccount.get(account.id) ?? 0;
      if (totalOutflow <= 0) continue; // no spending trend to project from
      const avgDailyOutflow = totalOutflow / 14;
      const runwayDays = account.currentBalance / avgDailyOutflow;
      if (runwayDays >= 10) continue;

      const roundedRunway = Math.max(0, Math.round(runwayDays));
      insights.push({
        key: `ai:cash-runway:${account.id}:${dayBucketKey()}`,
        category: AiInsightCategory.CASH,
        priority: runwayDays < 5 ? AiInsightPriority.CRITICAL : AiInsightPriority.HIGH,
        confidence: AiConfidence.HIGH,
        title: `Остатка «${account.name}» хватит ненадолго`,
        facts: [
          `При текущем темпе расходов остатка «${account.name}» (${fmtMoney(account.currentBalance)}) хватит примерно на ${roundedRunway} ${daysWordRu(roundedRunway)}.`,
        ],
        hypothesis: null,
        metrics: [
          { label: "Остаток", value: account.currentBalance, unit: "money" },
          { label: "Средний расход в день", value: avgDailyOutflow, unit: "money" },
          { label: "Хватит на", value: roundedRunway, unit: "days" },
        ],
        locationId: account.locationId,
        locationName: account.locationName,
        link: "/finance",
        createdAt: new Date().toISOString(),
      });
    }
    return insights;
  }

  // ── 8. Товар без продаж при регулярном производстве ───────────────

  private async computeIdleProductInsights(user: AuthenticatedUser): Promise<AiInsightDto[]> {
    const locationId = resolveLocationScope(user);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);

    const [batches, saleItems] = await Promise.all([
      this.prisma.productionBatch.findMany({
        where: { organizationId: user.organizationId, status: PrismaProductionBatchStatus.COMPLETED, completedAt: { gte: cutoff }, ...(locationId ? { locationId } : {}) },
        select: { actualQuantity: true, locationId: true, location: { select: { name: true } }, recipe: { select: { productId: true, product: { select: { name: true } } } } },
      }),
      this.prisma.saleItem.findMany({
        where: { sale: { organizationId: user.organizationId, soldAt: { gte: cutoff }, ...(locationId ? { locationId } : {}) } },
        select: { productId: true, quantity: true, sale: { select: { locationId: true } } },
      }),
    ]);

    const produced = new Map<string, { productId: string; name: string; qty: number; batchCount: number; locationId: string; locationName: string }>();
    for (const b of batches) {
      const productId = b.recipe.productId;
      const key = `${productId}:${b.locationId}`;
      const entry = produced.get(key) ?? { productId, name: b.recipe.product.name, qty: 0, batchCount: 0, locationId: b.locationId, locationName: b.location.name };
      entry.qty += b.actualQuantity?.toNumber() ?? 0;
      entry.batchCount += 1;
      produced.set(key, entry);
    }

    const sold = new Map<string, number>();
    for (const item of saleItems) {
      const key = `${item.productId}:${item.sale.locationId}`;
      sold.set(key, (sold.get(key) ?? 0) + item.quantity.toNumber());
    }

    const insights: AiInsightDto[] = [];
    for (const [key, entry] of produced) {
      if (entry.batchCount < 2 || entry.qty <= 0) continue;
      const soldQty = sold.get(key) ?? 0;
      if (soldQty / entry.qty >= 0.1) continue;

      insights.push({
        key: `ai:idle-product:${key}:${weekBucketKey()}`,
        category: AiInsightCategory.PRODUCTION,
        priority: AiInsightPriority.MEDIUM,
        confidence: AiConfidence.HIGH,
        title: `«${entry.name}» производится, но почти не продаётся`,
        facts: [
          `«${entry.name}» произведено ${entry.batchCount} ${timesWordRu(entry.batchCount)} за 2 недели (${fmtQty(entry.qty)} шт.), но продано только ${fmtQty(soldQty)} шт. — риск списания.`,
        ],
        hypothesis: null,
        metrics: [
          { label: "Произведено", value: entry.qty, unit: "count" },
          { label: "Продано", value: soldQty, unit: "count" },
        ],
        locationId: entry.locationId,
        locationName: entry.locationName,
        link: "/production",
        createdAt: new Date().toISOString(),
      });
    }
    return insights;
  }
}
