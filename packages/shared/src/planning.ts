import { Unit } from "./catalog";

// The management layer. Everything here READS the books and computes; nothing
// writes to them. Assumptions are always listed next to the result, and a
// parameter nobody has approved is labelled as an assumption, never as a rule.

// ── ABC / XYZ ────────────────────────────────────────────────────────────

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";

export interface AbcXyzRowDto {
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
  revenue: number;
  share: number; // % of total revenue
  cumulativeShare: number;
  abcClass: AbcClass;
  // Demand stability over weekly sales; null when there are too few weeks of data.
  xyzClass: XyzClass | null;
  coefficientOfVariation: number | null; // %
  weeksWithSales: number;
}

export interface AbcXyzReportDto {
  from: string;
  to: string;
  weeks: number;
  totalRevenue: number;
  rows: AbcXyzRowDto[];
  // Count of products in each cell, e.g. "AX": 3.
  matrix: Record<string, number>;
  thresholds: { aShare: number; bShare: number; xCv: number; yCv: number; minWeeks: number };
}

// ── min / max and reorder ────────────────────────────────────────────────

export type ReplenishmentStatus = "OK" | "REORDER" | "BELOW_MIN" | "NO_DEMAND";

export interface ReplenishmentAssumptionsDto {
  lookbackDays: number;
  leadTimeDays: number;
  safetyDays: number;
  reviewDays: number;
  // True when the caller did not state them: the figures are then illustrations, not rules.
  parametersAreDefaults: boolean;
}

export interface ReplenishmentRowDto {
  productId: string;
  productName: string;
  unit: Unit;
  onHand: number;
  onOrder: number;
  averageDailyDemand: number;
  daysOfCover: number | null;
  // The threshold currently set on the product (0 = none).
  currentMinQuantity: number;
  suggestedMin: number;
  reorderPoint: number;
  suggestedMax: number;
  suggestedOrder: number;
  status: ReplenishmentStatus;
}

export interface ReplenishmentReportDto {
  assumptions: ReplenishmentAssumptionsDto;
  rows: ReplenishmentRowDto[];
}

// ── plan vs fact ─────────────────────────────────────────────────────────

export enum PlanMetric {
  NET_REVENUE = "NET_REVENUE",
  COGS = "COGS",
  GROSS_PROFIT = "GROSS_PROFIT",
  OPERATING_EXPENSES = "OPERATING_EXPENSES",
  OPERATING_PROFIT = "OPERATING_PROFIT",
}

export const PLAN_METRIC_LABELS_RU: Record<PlanMetric, string> = {
  [PlanMetric.NET_REVENUE]: "Чистая выручка",
  [PlanMetric.COGS]: "Себестоимость",
  [PlanMetric.GROSS_PROFIT]: "Валовая прибыль",
  [PlanMetric.OPERATING_EXPENSES]: "Операционные расходы",
  [PlanMetric.OPERATING_PROFIT]: "Операционная прибыль",
};

// Metrics where a higher figure is worse (costs) — decides which variance is "bad".
export const PLAN_COST_METRICS: PlanMetric[] = [PlanMetric.COGS, PlanMetric.OPERATING_EXPENSES];

export interface PlanFactRowDto {
  metric: PlanMetric;
  label: string;
  plan: number | null;
  fact: number;
  variance: number | null; // fact − plan
  variancePercent: number | null;
  // Whether the deviation is unfavourable, given the metric's nature.
  unfavourable: boolean | null;
}

export interface PlanFactDto {
  year: number;
  month: number;
  // Fact comes from the frozen snapshot when the month is closed.
  factFromSnapshot: boolean;
  rows: PlanFactRowDto[];
}

export interface SetPlanRequestDto {
  year: number;
  month: number;
  lines: { metric: PlanMetric; amount: number | null }[];
}

// ── financial model ──────────────────────────────────────────────────────

// Explicit assumptions. A driver left null takes the baseline's own figure.
// There are NO tax drivers: the tax policy is not approved, so the model does
// not know a rate and says so in every result.
export interface ModelDriversDto {
  months: number;
  revenueGrowthPercentPerMonth: number;
  cogsPercentOfRevenue: number | null;
  fixedExpensesPerMonth: number | null;
  variableExpensePercentOfRevenue: number | null;
  capexPerMonth: number;
  ownerWithdrawalsPerMonth: number;
  loanRepaymentPerMonth: number;
  openingCash: number | null;
}

export interface ModelBaselineDto {
  from: string;
  to: string;
  months: number;
  averageMonthlyNetRevenue: number;
  cogsPercentOfRevenue: number;
  fixedExpensesPerMonth: number;
  variableExpensePercentOfRevenue: number;
  inventoryLossesPerMonth: number;
  openingCash: number;
  notes: string[];
}

export interface ForecastMonthDto {
  index: number; // 1-based
  year: number;
  month: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  variableExpenses: number;
  fixedExpenses: number;
  inventoryLosses: number;
  depreciation: number;
  operatingProfit: number;
  // null: the tax policy is not configured — never assumed to be zero.
  incomeTax: null;
  netProfit: number;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netCashFlow: number;
  closingCash: number;
}

export interface ForecastTotalsDto {
  netRevenue: number;
  operatingProfit: number;
  netProfit: number;
  netCashFlow: number;
  endingCash: number;
  minimumCash: number;
  minimumCashMonthIndex: number;
}

export interface ForecastDto {
  baseline: ModelBaselineDto;
  drivers: ModelDriversDto;
  months: ForecastMonthDto[];
  totals: ForecastTotalsDto;
  // Monthly revenue at which operating profit is zero; null when the margin cannot cover fixed costs.
  breakEvenMonthlyRevenue: number | null;
  netProfitStatus: "PRELIMINARY";
  notConfigured: string[];
  assumptions: string[];
}

export interface ScenarioDto {
  id: string;
  name: string;
  note: string | null;
  drivers: ModelDriversDto;
  createdAt: string;
  updatedAt: string;
}

export interface SaveScenarioRequestDto {
  name: string;
  note?: string;
  drivers: ModelDriversDto;
}

export interface ScenarioComparisonRowDto {
  scenarioId: string;
  name: string;
  totals: ForecastTotalsDto;
  breakEvenMonthlyRevenue: number | null;
}

export interface ScenarioComparisonDto {
  baseline: ModelBaselineDto;
  rows: ScenarioComparisonRowDto[];
}
