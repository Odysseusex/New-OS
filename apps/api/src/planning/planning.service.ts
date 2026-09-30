import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AbcXyzReportDto,
  AbcXyzRowDto,
  DepreciationMethod,
  ForecastDto,
  ModelBaselineDto,
  ModelDriversDto,
  PLAN_COST_METRICS,
  PLAN_METRIC_LABELS_RU,
  PlanFactDto,
  PlanFactRowDto,
  PlanMetric,
  ReplenishmentReportDto,
  ReplenishmentRowDto,
  SaveScenarioRequestDto,
  ScenarioComparisonDto,
  ScenarioDto,
  SetPlanRequestDto,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { FinanceService } from "../finance/finance.service";
import { AccountingPolicyService } from "../finance/accounting-policy.service";
import { FinancialPeriodsService } from "../finance/periods/periods.service";
import { round2 } from "../common/money";
import { monthOf, monthRange, REPORTING_UTC_OFFSET_HOURS } from "../common/reporting-period";
import { ABC_XYZ_DEFAULTS, classifyAbc, classifyXyz, coefficientOfVariation } from "./abc-xyz";
import { planReplenishment } from "./replenishment";
import { forecast, validateDrivers } from "./forecast";
import { depreciationCalculators, resolveDepreciableTerms } from "../fixed-assets/depreciation-calculators";

const DAY = 86400_000;
const WEEK = 7 * DAY;

// The management layer over the books. It reads Core Finance (P&L, cash,
// register, stock) and writes ONLY its own tables (plan lines and scenarios);
// nothing here posts, adjusts or reclassifies accounting data.
@Injectable()
export class PlanningService {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
    private periods: FinancialPeriodsService = new FinancialPeriodsService(prisma, finance),
    private policy: AccountingPolicyService = new AccountingPolicyService(prisma),
  ) {}

  // ── ABC / XYZ ──────────────────────────────────────────────────────────

  async abcXyz(organizationId: string, from: Date, to: Date, locationId?: string): Promise<AbcXyzReportDto> {
    // Revenue and quantity are the P&L's own per-product figures (net of returns).
    const [pnl, items] = await Promise.all([
      this.finance.getProfitAndLoss(organizationId, from, to, locationId),
      this.prisma.saleItem.findMany({
        where: { sale: { organizationId, soldAt: { gte: from, lte: to }, ...(locationId ? { locationId } : {}) } },
        select: { productId: true, quantity: true, sale: { select: { soldAt: true } } },
      }),
    ]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: pnl.byProduct.map((p) => p.productId) } },
      select: { id: true, unit: true },
    });
    const unitOf = new Map(products.map((p) => [p.id, p.unit as Unit]));

    // Weekly demand, Monday-based weeks in the reporting time zone, ALL weeks of
    // the window including empty ones.
    const offset = REPORTING_UTC_OFFSET_HOURS * 3600_000;
    const weekStart = (t: number) => {
      const shifted = t + offset;
      const day = new Date(shifted).getUTCDay(); // 0 = Sunday
      const sinceMonday = (day + 6) % 7;
      return Math.floor(shifted / DAY) * DAY - sinceMonday * DAY;
    };
    // Only WHOLE weeks count: the partial week at each end of the window would
    // read as a slump that is really just a short week.
    let firstWeek = weekStart(from.getTime());
    const fromDayStart = Math.floor((from.getTime() + offset) / DAY) * DAY;
    if (firstWeek < fromDayStart) firstWeek += WEEK;
    let lastWeek = weekStart(to.getTime());
    const toDayEnd = Math.floor((to.getTime() + offset) / DAY) * DAY + DAY;
    if (lastWeek + WEEK > toDayEnd) lastWeek -= WEEK; // the week containing `to` is still running
    const weekCount = Math.max(0, Math.round((lastWeek - firstWeek) / WEEK) + 1);
    const weekly = new Map<string, number[]>();
    for (const item of items) {
      const index = Math.round((weekStart(item.sale.soldAt.getTime()) - firstWeek) / WEEK);
      if (index < 0 || index >= weekCount) continue;
      const series = weekly.get(item.productId) ?? Array.from({ length: weekCount }, () => 0);
      series[index] += item.quantity.toNumber();
      weekly.set(item.productId, series);
    }

    const classified = classifyAbc(
      pnl.byProduct.map((p) => ({ id: p.productId, name: p.productName, revenue: p.revenue, quantity: p.quantitySold })),
    );
    const matrix: Record<string, number> = {};
    const rows: AbcXyzRowDto[] = classified.map((c) => {
      const series = weekly.get(c.id) ?? Array.from({ length: weekCount }, () => 0);
      const cv = coefficientOfVariation(series);
      const weeksWithSales = series.filter((v) => v > 0).length;
      const xyz = weekCount >= ABC_XYZ_DEFAULTS.minWeeks ? classifyXyz(cv, weeksWithSales) : null;
      const key = `${c.abcClass}${xyz ?? "?"}`;
      matrix[key] = (matrix[key] ?? 0) + 1;
      return {
        productId: c.id,
        productName: c.name,
        unit: unitOf.get(c.id) ?? Unit.PCS,
        quantity: c.quantity,
        revenue: c.revenue,
        share: c.share,
        cumulativeShare: c.cumulativeShare,
        abcClass: c.abcClass,
        xyzClass: xyz,
        coefficientOfVariation: cv === null ? null : Math.round(cv * 10) / 10,
        weeksWithSales,
      };
    });
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      weeks: weekCount,
      totalRevenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      rows,
      matrix,
      thresholds: ABC_XYZ_DEFAULTS,
    };
  }

  // ── min / max and reorder ──────────────────────────────────────────────

  async replenishment(
    organizationId: string,
    params: { lookbackDays?: number; leadTimeDays?: number; safetyDays?: number; reviewDays?: number; locationId?: string },
  ): Promise<ReplenishmentReportDto> {
    const lookbackDays = params.lookbackDays ?? 28;
    const stated = params.leadTimeDays !== undefined && params.safetyDays !== undefined && params.reviewDays !== undefined;
    // Not invented policy: unstated lead time / safety / review are illustrative
    // defaults and the report says so.
    const assumptions = {
      lookbackDays,
      leadTimeDays: params.leadTimeDays ?? 2,
      safetyDays: params.safetyDays ?? 1,
      reviewDays: params.reviewDays ?? 7,
      parametersAreDefaults: !stated,
    };
    if (lookbackDays < 1 || lookbackDays > 365 || assumptions.leadTimeDays < 0 || assumptions.safetyDays < 0 || assumptions.reviewDays < 0) {
      throw new BadRequestException("Неверные параметры расчёта");
    }
    const since = new Date(Date.now() - lookbackDays * DAY);
    const [levels, sold, ordered, products] = await Promise.all([
      this.prisma.stockLevel.groupBy({
        by: ["productId"],
        where: { organizationId, ...(params.locationId ? { locationId: params.locationId } : {}), product: { trackInventory: true } },
        _sum: { quantity: true },
      }),
      this.prisma.saleItem.groupBy({
        by: ["productId"],
        where: { sale: { organizationId, soldAt: { gte: since }, ...(params.locationId ? { locationId: params.locationId } : {}) } },
        _sum: { quantity: true },
      }),
      this.prisma.purchaseOrderItem.groupBy({
        by: ["productId"],
        where: { purchaseOrder: { organizationId, status: "PLACED", ...(params.locationId ? { locationId: params.locationId } : {}) } },
        _sum: { quantity: true },
      }),
      this.prisma.product.findMany({ where: { organizationId, trackInventory: true, isActive: true }, select: { id: true, name: true, unit: true, minQuantity: true } }),
    ]);
    const onHand = new Map(levels.map((l) => [l.productId, l._sum.quantity?.toNumber() ?? 0]));
    const soldQty = new Map(sold.map((s) => [s.productId, s._sum.quantity?.toNumber() ?? 0]));
    const onOrder = new Map(ordered.map((o) => [o.productId, o._sum.quantity?.toNumber() ?? 0]));

    const rows: ReplenishmentRowDto[] = products.map((p) => {
      const avg = (soldQty.get(p.id) ?? 0) / lookbackDays;
      const plan = planReplenishment(
        { onHand: onHand.get(p.id) ?? 0, onOrder: onOrder.get(p.id) ?? 0, averageDailyDemand: avg, currentMinQuantity: p.minQuantity.toNumber() },
        assumptions,
      );
      return {
        productId: p.id,
        productName: p.name,
        unit: p.unit as Unit,
        onHand: onHand.get(p.id) ?? 0,
        onOrder: onOrder.get(p.id) ?? 0,
        averageDailyDemand: Math.round(avg * 1000) / 1000,
        currentMinQuantity: p.minQuantity.toNumber(),
        ...plan,
      };
    });
    const rank = { BELOW_MIN: 0, REORDER: 1, OK: 2, NO_DEMAND: 3 } as const;
    rows.sort((a, b) => rank[a.status] - rank[b.status] || a.productName.localeCompare(b.productName));
    return { assumptions, rows };
  }

  // ── plan vs fact ───────────────────────────────────────────────────────

  async setPlan(user: AuthenticatedUser, dto: SetPlanRequestDto): Promise<PlanFactDto> {
    if (!Number.isInteger(dto.year) || dto.month < 1 || dto.month > 12) throw new BadRequestException("Неверный период");
    await this.prisma.$transaction(async (tx) => {
      for (const line of dto.lines) {
        if (line.amount === null) {
          await tx.managementPlanLine.deleteMany({
            where: { organizationId: user.organizationId, year: dto.year, month: dto.month, metric: line.metric },
          });
          continue;
        }
        if (!Number.isFinite(line.amount)) throw new BadRequestException("Неверная сумма плана");
        await tx.managementPlanLine.upsert({
          where: { organizationId_year_month_metric: { organizationId: user.organizationId, year: dto.year, month: dto.month, metric: line.metric } },
          create: { organizationId: user.organizationId, year: dto.year, month: dto.month, metric: line.metric, amount: line.amount, createdById: user.id },
          update: { amount: line.amount },
        });
      }
    });
    return this.planFact(user.organizationId, dto.year, dto.month);
  }

  async planFact(organizationId: string, year: number, month: number): Promise<PlanFactDto> {
    const range = monthRange(year, month);
    const [lines, frozen] = await Promise.all([
      this.prisma.managementPlanLine.findMany({ where: { organizationId, year, month } }),
      this.periods.frozenSection<{ netRevenue: number; cogs: number; grossProfit: number; expensesTotal: number; operatingProfit: number }>(organizationId, year, month, "pnl"),
    ]);
    const pnl = frozen?.data ?? (await this.finance.getProfitAndLoss(organizationId, range.start, range.end));
    const fact: Record<PlanMetric, number> = {
      [PlanMetric.NET_REVENUE]: pnl.netRevenue,
      [PlanMetric.COGS]: pnl.cogs,
      [PlanMetric.GROSS_PROFIT]: pnl.grossProfit,
      [PlanMetric.OPERATING_EXPENSES]: pnl.expensesTotal,
      [PlanMetric.OPERATING_PROFIT]: pnl.operatingProfit,
    };
    const planned = new Map(lines.map((l) => [l.metric as PlanMetric, l.amount.toNumber()]));
    const rows: PlanFactRowDto[] = Object.values(PlanMetric).map((metric) => {
      const plan = planned.get(metric) ?? null;
      const variance = plan === null ? null : round2(fact[metric] - plan);
      const isCost = PLAN_COST_METRICS.includes(metric);
      return {
        metric,
        label: PLAN_METRIC_LABELS_RU[metric],
        plan,
        fact: fact[metric],
        variance,
        variancePercent: plan === null || plan === 0 ? null : Math.round(((fact[metric] - plan) / Math.abs(plan)) * 1000) / 10,
        unfavourable: variance === null || variance === 0 ? null : isCost ? variance > 0 : variance < 0,
      };
    });
    return { year, month, factFromSnapshot: !!frozen, rows };
  }

  // ── financial model ────────────────────────────────────────────────────

  // The baseline: the last fully elapsed months of the books, READ. Nothing is
  // written; nothing in it is an assumption except which months were chosen.
  async baseline(organizationId: string, baselineMonths = 3): Promise<ModelBaselineDto> {
    if (!Number.isInteger(baselineMonths) || baselineMonths < 1 || baselineMonths > 24) throw new BadRequestException("Базовый период — от 1 до 24 месяцев");
    const current = monthOf(new Date());
    let y = current.year;
    let m = current.month - 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    const endRange = monthRange(y, m);
    let sy = y;
    let sm = m - (baselineMonths - 1);
    while (sm < 1) {
      sm += 12;
      sy -= 1;
    }
    const from = monthRange(sy, sm).start;
    const to = endRange.end;
    const [pnl, breakEven, accounts] = await Promise.all([
      this.finance.getProfitAndLoss(organizationId, from, to),
      this.finance.getBreakEven(organizationId, from, to),
      this.prisma.cashAccount.findMany({ where: { organizationId, isActive: true }, select: { currentBalance: true } }),
    ]);
    const notes: string[] = [];
    if (pnl.netRevenue <= 0) notes.push("В базовом периоде нет выручки — прогноз будет нулевым");
    if (breakEven.unclassifiedExpensesTotal > 0) notes.push("Часть расходов не отнесена к постоянным/переменным — учтена как постоянные");
    if (pnl.notConfigured.length > 0) notes.push("Чистая прибыль базового периода предварительная");
    const revenue = pnl.netRevenue;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      months: baselineMonths,
      averageMonthlyNetRevenue: round2(revenue / baselineMonths),
      cogsPercentOfRevenue: revenue > 0 ? Math.round((pnl.cogs / revenue) * 10000) / 100 : 0,
      fixedExpensesPerMonth: round2((breakEven.fixedExpensesTotal + breakEven.unclassifiedExpensesTotal) / baselineMonths),
      variableExpensePercentOfRevenue: revenue > 0 ? Math.round((breakEven.variableExpensesTotal / revenue) * 10000) / 100 : 0,
      inventoryLossesPerMonth: round2(pnl.inventoryLosses / baselineMonths),
      openingCash: round2(accounts.reduce((s, a) => s + a.currentBalance.toNumber(), 0)),
      notes,
    };
  }

  async run(organizationId: string, drivers: ModelDriversDto, baselineMonths = 3, baseline?: ModelBaselineDto): Promise<ForecastDto> {
    const problem = validateDrivers(drivers);
    if (problem) throw new BadRequestException(problem);
    const base = baseline ?? (await this.baseline(organizationId, baselineMonths));
    const schedule = await this.depreciationSchedule(organizationId);
    return forecast(base, drivers, monthOf(new Date()), schedule);
  }

  async compare(organizationId: string, scenarioIds: string[], baselineMonths = 3): Promise<ScenarioComparisonDto> {
    if (scenarioIds.length === 0) throw new BadRequestException("Выберите хотя бы один сценарий");
    const scenarios = await this.prisma.financialModelScenario.findMany({ where: { organizationId, id: { in: scenarioIds } } });
    const base = await this.baseline(organizationId, baselineMonths);
    const rows = [];
    for (const s of scenarios) {
      const result = await this.run(organizationId, s.drivers as unknown as ModelDriversDto, baselineMonths, base);
      rows.push({ scenarioId: s.id, name: s.name, totals: result.totals, breakEvenMonthlyRevenue: result.breakEvenMonthlyRevenue });
    }
    return { baseline: base, rows };
  }

  async listScenarios(organizationId: string): Promise<ScenarioDto[]> {
    const rows = await this.prisma.financialModelScenario.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    return rows.map(this.toScenarioDto);
  }

  async saveScenario(user: AuthenticatedUser, dto: SaveScenarioRequestDto, id?: string): Promise<ScenarioDto> {
    const problem = validateDrivers(dto.drivers);
    if (problem) throw new BadRequestException(problem);
    if (!dto.name.trim()) throw new BadRequestException("Укажите название сценария");
    const data = { name: dto.name.trim(), note: dto.note, drivers: dto.drivers as unknown as Prisma.InputJsonValue };
    if (id) {
      const existing = await this.prisma.financialModelScenario.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!existing) throw new NotFoundException("Сценарий не найден");
      return this.toScenarioDto(await this.prisma.financialModelScenario.update({ where: { id }, data }));
    }
    return this.toScenarioDto(
      await this.prisma.financialModelScenario.create({ data: { ...data, organizationId: user.organizationId, createdById: user.id } }),
    );
  }

  async deleteScenario(organizationId: string, id: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.financialModelScenario.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Сценарий не найден");
    await this.prisma.financialModelScenario.delete({ where: { id } });
    return { deleted: true };
  }

  // The register's own depreciation, month by month into the future, from the
  // terms already stated on each asset. Reads only; assets without terms add nothing.
  private async depreciationSchedule(organizationId: string): Promise<(index: number, year: number, month: number) => number> {
    const [assets, policy] = await Promise.all([
      this.prisma.fixedAsset.findMany({ where: { organizationId, status: "ACTIVE" }, include: { depreciation: true } }),
      this.policy.get(organizationId),
    ]);
    const policyMethod = policy.depreciationMethod.source === "APPROVED" ? (policy.depreciationMethod.value as DepreciationMethod) : null;
    const policyLife = policy.depreciationUsefulLifeMonths.source === "APPROVED" ? policy.depreciationUsefulLifeMonths.value : null;
    const prepared = assets
      .map((a) => ({ terms: resolveDepreciableTerms(a, policyMethod, policyLife), accumulated: a.depreciation.reduce((s, e) => s + e.amount.toNumber(), 0), posted: new Set(a.depreciation.map((e) => `${e.year}-${e.month}`)) }))
      .filter((a) => a.terms !== null);
    return (_index, year, month) => {
      let total = 0;
      for (const a of prepared) {
        const calc = depreciationCalculators.get(a.terms!.method);
        if (!calc || a.posted.has(`${year}-${month}`)) continue;
        const charge = calc.monthlyCharge(a.terms!, { year, month, accumulated: a.accumulated });
        total += charge;
        a.accumulated = round2(a.accumulated + charge);
      }
      return total;
    };
  }

  private toScenarioDto = (s: { id: string; name: string; note: string | null; drivers: Prisma.JsonValue; createdAt: Date; updatedAt: Date }): ScenarioDto => ({
    id: s.id,
    name: s.name,
    note: s.note,
    drivers: s.drivers as unknown as ModelDriversDto,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  });
}
