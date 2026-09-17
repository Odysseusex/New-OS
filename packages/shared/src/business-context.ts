import type { AiInsightDto } from "./ai";
import type { BreakEvenDto, CashFlowDto, ProfitAndLossDto } from "./finance";
import type { ProductProfitabilityRowDto, SalesDynamicsDto } from "./sales";
import type { QualitySummaryDto } from "./inventory";
import type { ConsignmentBalanceDto } from "./consignment";
import type { EmployeeKpiDto } from "./hr";
import type { ProductType, Unit } from "./catalog";

// ── AI Business Context ───────────────────────────────────────────────
//
// The provider-agnostic layer between ArAmir and any external AI. Today it
// is copied into ChatGPT by hand; tomorrow the same DTO is what an OpenAI or
// Claude integration would post, with no change to how it is collected. The
// Markdown rendering in business-context-format.ts is one projection of this
// contract, never the contract itself.
//
// Two rules the whole design rests on:
//
//   1. Every number here is PROJECTED from the service that already owns it
//      (SalesService, FinanceService, QualityService, …) — never recomputed
//      by a second formula. Reports, the AI Center and this export therefore
//      cannot disagree about the same period.
//
//   2. Computed analytics AND the raw inputs behind them both travel. The
//      consumer is a reasoning model that should be able to check our
//      arithmetic and ask questions nobody designed a field for — so where a
//      field is small and plausibly useful, it stays.
//
// Absent data is NEVER invented. What the system does not record is listed
// in `meta.limitations` instead, so the model knows the edge of what it can
// conclude rather than filling the gap itself.

// Bumped when the shape changes in a way an older reader could misread. Sent
// in the export so a context file found a year from now is still parseable
// against the right expectations.
export const BUSINESS_CONTEXT_SCHEMA_VERSION = "1.0";

// Every report in this app buckets calendar days on an Almaty wall clock —
// stated here so the model never has to guess which day a 9pm sale belongs
// to. Mirrors REPORTING_TIME_ZONE in the API and on the web.
export const BUSINESS_CONTEXT_TIME_ZONE = "Asia/Almaty";

// Single-currency system: there is no per-organization currency setting
// anywhere in the schema, and every money formatter in the app hardcodes
// this. Stated explicitly rather than left implicit in the numbers.
export const BUSINESS_CONTEXT_CURRENCY = "KZT";

export type BusinessContextLevel = "quick" | "business" | "full";

export const BUSINESS_CONTEXT_MODULES = [
  "sales",
  "production",
  "inventory",
  "purchases",
  "writeOffs",
  "recipes",
  "finance",
  "customers",
  "personnel",
  "insights",
] as const;

export type BusinessContextModule = (typeof BUSINESS_CONTEXT_MODULES)[number];

export const BUSINESS_CONTEXT_MODULE_LABELS_RU: Record<BusinessContextModule, string> = {
  sales: "Продажи",
  production: "Производство",
  inventory: "Склад",
  purchases: "Закупки",
  writeOffs: "Списания",
  recipes: "Рецептуры",
  finance: "Финансы",
  customers: "Клиенты",
  personnel: "Персонал",
  insights: "AI-инсайты",
};

// ── Metadata ──────────────────────────────────────────────────────────

export type BusinessContextScope =
  | { kind: "network" }
  | { kind: "location"; locationId: string; locationName: string };

export interface BusinessContextLocationDto {
  id: string;
  name: string;
  city: string;
  type: string;
  isActive: boolean;
}

export interface BusinessContextMetaDto {
  schemaVersion: string;
  generatedAt: string;
  businessName: string;
  period: { from: string; to: string; days: number };
  timeZone: string;
  currency: string;
  exportLevel: BusinessContextLevel;
  scope: BusinessContextScope;
  locationsIncluded: BusinessContextLocationDto[];
  includedModules: BusinessContextModule[];
  recordCounts: Record<string, number>;
  // Facts about THIS export's completeness — "4 товара без себестоимости".
  // Derived from the data actually collected, never a static list.
  warnings: string[];
  // Facts about what ArAmir does not record AT ALL, regardless of period —
  // "фактический расход сырья на партию не хранится". Stops the model
  // inventing precision the business does not have.
  limitations: string[];
}

// ── Reference data (products, recipes, locations) ─────────────────────

export interface BusinessContextProductDto {
  id: string;
  sku: string;
  name: string;
  type: ProductType;
  unit: Unit;
  category: string | null;
  // FINISHED_GOOD: the client sale price. RAW_MATERIAL: the cost input
  // recipe costing consumes — the same column means different things by
  // type, so both are labelled rather than merged into one "price".
  sellingPrice: number | null;
  costPrice: number | null;
  // Resolved unit cost and where it came from, so the model can tell a
  // recipe-costed product from one priced off past purchases — and tell
  // both from one it cannot cost at all.
  unitCost: number | null;
  costSource: "recipe" | "purchase" | "none";
  hasRecipe: boolean;
  shelfLifeDays: number | null;
  minQuantity: number;
  trackInventory: boolean;
  isActive: boolean;
  consignment: { supplierId: string; supplierName: string; unitCost: number } | null;
}

export interface BusinessContextRecipeIngredientDto {
  productId: string;
  name: string;
  // Per whole batch, in the ingredient's own base unit.
  quantity: number;
  unit: Unit;
  unitCost: number | null;
  lineCost: number | null;
}

export interface BusinessContextRecipeDto {
  recipeId: string;
  productId: string;
  productName: string;
  // Units of finished product one batch yields, before loss.
  yieldQuantity: number;
  lossPercent: number | null;
  // Yield after loss — what unitCost is actually divided by.
  effectiveYield: number;
  pieceWeightG: number | null;
  shelfLifeDays: number | null;
  totalIngredientCost: number | null;
  unitCost: number | null;
  isActive: boolean;
  ingredients: BusinessContextRecipeIngredientDto[];
}

// ── Sales ─────────────────────────────────────────────────────────────

export interface BusinessContextSalesLocationRowDto {
  locationId: string;
  locationName: string;
  revenue: number;
  salesCount: number;
  averageTicket: number | null;
}

export interface BusinessContextSalesDto {
  totalRevenue: number;
  salesCount: number;
  averageTicket: number | null;
  // Totals over products that can be costed, plus what that excludes —
  // mirrors ProductProfitabilityDto so the two never disagree.
  totalCost: number;
  totalMargin: number;
  totalMarginPercent: number | null;
  revenueWithoutCostData: number;
  productsWithoutCostData: number;
  markdownLoss: number;
  markdownQuantity: number;
  // Every product sold in the period, not a top-N: this is for a model that
  // may be asked about any of them, not a table a person scrolls.
  byProduct: ProductProfitabilityRowDto[];
  byLocation: BusinessContextSalesLocationRowDto[];
  // Day-by-day, by hour and by weekday. Dropped to weekly points at the
  // higher levels only when the period is long enough to make daily rows
  // dominate the whole export.
  dynamics: SalesDynamicsDto | null;
}

// ── Production ────────────────────────────────────────────────────────

export interface BusinessContextProductionRowDto {
  productId: string;
  productName: string;
  unit: Unit;
  batchesPlanned: number;
  batchesInProgress: number;
  batchesCompleted: number;
  batchesCancelled: number;
  plannedQuantity: number;
  // Completed batches only — a planned batch has no actual yet.
  actualQuantity: number;
  // actualQuantity − plannedQuantity over COMPLETED batches. This is
  // production variance: how much a batch under- or over-delivered against
  // its plan. It is NOT a waste rate, and is deliberately kept apart from
  // the write-off figures, which are a different event entirely.
  varianceQuantity: number;
  variancePercent: number | null;
}

export interface BusinessContextProductionDto {
  batchesTotal: number;
  unitsPlanned: number;
  unitsProduced: number;
  byProduct: BusinessContextProductionRowDto[];
}

// ── Inventory ─────────────────────────────────────────────────────────

export interface BusinessContextStockRowDto {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  unit: Unit;
  quantity: number;
  minQuantity: number;
  isLow: boolean;
}

export interface BusinessContextMovementRowDto {
  type: string;
  totalQuantity: number;
  movementCount: number;
}

export interface BusinessContextInventoryDto {
  // Snapshot as of generatedAt, NOT as of the period end — stock levels are
  // a current figure, and the schema keeps no historical snapshot to
  // reconstruct an opening balance from. Said plainly in meta.limitations.
  currentStock: BusinessContextStockRowDto[];
  lowStockCount: number;
  // Every stock movement in the period, grouped by type. Receipts,
  // write-offs, production output and consumption, sales and returns all
  // appear here as their own type rather than being netted together.
  movementsByType: BusinessContextMovementRowDto[];
  // Cost of what is on hand right now, from the same resolution the P&L
  // charges as COGS.
  valuationTotal: number | null;
  valuationUnknownLines: number;
}

// ── Purchases ─────────────────────────────────────────────────────────

export interface BusinessContextPurchaseSupplierRowDto {
  supplierId: string;
  supplierName: string;
  totalCost: number;
  orderCount: number;
}

export interface BusinessContextPurchaseProductRowDto {
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
  totalCost: number;
  averageUnitCost: number | null;
}

export interface BusinessContextPurchasesDto {
  ordersTotalCost: number;
  ordersCount: number;
  bySupplier: BusinessContextPurchaseSupplierRowDto[];
  byProduct: BusinessContextPurchaseProductRowDto[];
  // Supplier delivery notes — a second, independent way goods arrive, which
  // is why they are reported separately rather than summed with orders.
  invoicesTotalCost: number;
  invoicesCount: number;
  invoicesUnpaid: number;
}

// ── Customers ─────────────────────────────────────────────────────────

export interface BusinessContextCustomerRowDto {
  customerId: string;
  name: string;
  revenue: number;
  salesCount: number;
  averageTicket: number | null;
  outstandingBalance: number;
  creditLimit: number | null;
}

export interface BusinessContextCustomersDto {
  activeCount: number;
  totalOutstanding: number;
  // Revenue attributed to walk-in sales with no named customer.
  retailRevenue: number;
  retailSalesCount: number;
  byCustomer: BusinessContextCustomerRowDto[];
}

// ── Finance ───────────────────────────────────────────────────────────

export interface BusinessContextFinanceDto {
  pnl: ProfitAndLossDto;
  breakEven: BreakEvenDto;
  cashFlow: CashFlowDto | null;
  accountsReceivable: number;
  accountsPayable: number;
  consignmentOwed: number;
  consignmentBalances: ConsignmentBalanceDto[];
}

// ── Root ──────────────────────────────────────────────────────────────

export interface BusinessContextDto {
  meta: BusinessContextMetaDto;
  locations: BusinessContextLocationDto[];
  products: BusinessContextProductDto[];
  recipes: BusinessContextRecipeDto[] | null;
  sales: BusinessContextSalesDto | null;
  production: BusinessContextProductionDto | null;
  inventory: BusinessContextInventoryDto | null;
  purchases: BusinessContextPurchasesDto | null;
  writeOffs: QualitySummaryDto | null;
  finance: BusinessContextFinanceDto | null;
  customers: BusinessContextCustomersDto | null;
  personnel: EmployeeKpiDto[] | null;
  insights: AiInsightDto[] | null;
}
