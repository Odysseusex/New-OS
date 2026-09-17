"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Download, Printer } from "lucide-react";
import type {
  CategoryDto,
  CustomerDto,
  HrKpiResponseDto,
  LocationDto,
  ProductDto,
  ProductProfitabilityDto,
  ProfitAndLossDto,
  PromotionDto,
  PromotionReportDto,
  QualitySummaryDto,
  CashFlowDto,
  SalesDynamicsDto,
  SalesCustomerTrendDto,
  SalesDemandAnalysisDto,
  SalesReportDto,
  StockLevelDto,
} from "@bakery-os/shared";
import {
  CUSTOMER_VIEW_ROLES,
  FINANCE_VIEW_ROLES,
  HR_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  PROMOTION_MANAGE_ROLES,
  ProductType,
  QUALITY_VIEW_ROLES,
  UNIT_LABELS_RU,
  WRITE_OFF_REASON_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv } from "@/lib/csv";
import {
  addDaysKey,
  endOfZonedDay,
  firstOfMonthKey,
  startOfZonedDay,
  zonedDateKey,
} from "@/lib/reporting-period";
import { formatAverage, formatDayKey, formatMoney, formatQuantity } from "@/lib/format";
import { SalesTrendChart, type TrendMetric } from "@/components/sales-trend-chart";
import {
  HourlyRevenueChart,
  RevenueTrendChart,
  WeekdayRevenueChart,
} from "@/components/revenue-charts";

type ReportKey =
  | "finance"
  | "sales"
  | "profitability"
  | "dynamics"
  | "cashflow"
  | "trend"
  | "quality"
  | "hr"
  | "stock"
  | "promotions";
type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "90d" | "year";

// Ordered shortest to longest, which is the order they are rendered in.
// «Вчера» exists because it is the single most asked-for report — the owner is
// asked for yesterday's numbers the next morning, and computing them from a
// 7-day total is not something anyone should have to do by hand. The two long
// ones exist so the month-by-month history below has more than one month in it.
const PERIOD_LABELS: Record<Period, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
  "90d": "3 месяца",
  year: "Год",
};

// Built on Almaty calendar days, not the browser's, because that is how the
// server buckets every report — see lib/reporting-period.ts. Asked for in the
// browser's own days instead, «Вчера» came back spanning two of the server's.
function periodRange(period: Period): { from: Date; to: Date } {
  const today = zonedDateKey();
  const startDaysBack = (days: number) => startOfZonedDay(addDaysKey(today, -days));

  if (period === "yesterday") {
    // The only period that does not end "now": yesterday is a closed day, so
    // its window has to close at the end of it. Left running to now, it would
    // silently include today's sales and stop being yesterday at all.
    const key = addDaysKey(today, -1);
    return { from: startOfZonedDay(key), to: endOfZonedDay(key) };
  }

  const to = new Date();
  if (period === "7d") return { from: startDaysBack(6), to };
  if (period === "30d") return { from: startDaysBack(29), to };
  if (period === "month") return { from: startOfZonedDay(firstOfMonthKey(today)), to };
  if (period === "90d") return { from: startDaysBack(89), to };
  if (period === "year") return { from: startDaysBack(364), to };
  return { from: startOfZonedDay(today), to };
}

export default function ReportsPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;

  const availableReports: { key: ReportKey; label: string }[] = [
    ...(user && FINANCE_VIEW_ROLES.includes(user.role) ? [{ key: "finance" as const, label: "Финансы (P&L)" }] : []),
    { key: "sales" as const, label: "Продажи" },
    // Margin per product needs the same cost data the P&L is built on, so it
    // is gated with the P&L rather than with the sales list: it exposes what
    // each product costs us, which the sales figures alone do not.
    ...(user && FINANCE_VIEW_ROLES.includes(user.role)
      ? [{ key: "profitability" as const, label: "Рентабельность" }]
      : []),
    { key: "dynamics" as const, label: "Динамика продаж" },
    ...(user && FINANCE_VIEW_ROLES.includes(user.role) ? [{ key: "cashflow" as const, label: "ДДС" }] : []),
    // Needs a customer to be picked, and the customer list is gated on
    // CUSTOMER_VIEW_ROLES — without them the tab could only ever show an
    // empty dropdown.
    ...(user && CUSTOMER_VIEW_ROLES.includes(user.role) ? [{ key: "trend" as const, label: "Динамика по клиенту" }] : []),
    ...(user && QUALITY_VIEW_ROLES.includes(user.role)
      ? [{ key: "quality" as const, label: "Качество и списания" }]
      : []),
    ...(user && HR_MANAGE_ROLES.includes(user.role) ? [{ key: "hr" as const, label: "Персонал (KPI)" }] : []),
    { key: "stock" as const, label: "Остатки склада" },
    // Same admin bar as creating/editing a campaign — a promotion's numbers
    // are as sensitive as the discount decision itself.
    ...(user && PROMOTION_MANAGE_ROLES.includes(user.role) ? [{ key: "promotions" as const, label: "Акции" }] : []),
  ];

  const [activeReport, setActiveReport] = useState<ReportKey>(availableReports[0]?.key ?? "sales");
  const [period, setPeriod] = useState<Period>("30d");
  const [locationFilter, setLocationFilter] = useState("");
  const [locations, setLocations] = useState<LocationDto[]>([]);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
  }, []);

  if (availableReports.length === 0) return null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Отчёты</h1>
        <p className="mt-1 text-sm text-muted">Библиотека готовых отчётов по сети</p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
        {availableReports.map((r) => (
          <button
            key={r.key}
            onClick={() => setActiveReport(r.key)}
            className={clsx(
              "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
              activeReport === r.key ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Динамика carries its own period control (it needs 3 месяца and a
              custom range, which the other tabs don't), so the shared one
              would just contradict it. */}
          {activeReport !== "stock" && activeReport !== "trend" && (
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={clsx(
                    "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
                    period === p ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
                  )}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          )}

          {isOrgWide && (
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Вся сеть</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted print:hidden"
        >
          <Printer className="h-4 w-4" strokeWidth={1.75} />
          Печать
        </button>
      </div>

      <div className="printable-report">
        {activeReport === "finance" && <FinanceReport period={period} locationId={locationFilter} />}
        {activeReport === "sales" && (
          <SalesReport period={period} locationId={locationFilter} isOrgWide={isOrgWide} />
        )}
        {activeReport === "profitability" && (
          <ProfitabilityReport period={period} locationId={locationFilter} />
        )}
        {activeReport === "dynamics" && <DynamicsReport period={period} locationId={locationFilter} />}
        {activeReport === "cashflow" && <CashFlowReport period={period} />}
        {activeReport === "trend" && <CustomerSalesTrendCard locationId={locationFilter} />}
        {activeReport === "quality" && <QualityReport period={period} locationId={locationFilter} />}
        {activeReport === "hr" && <HrReport period={period} locationId={locationFilter} />}
        {activeReport === "stock" && <StockReport locationId={locationFilter} isOrgWide={isOrgWide} />}
        {activeReport === "promotions" && <PromotionsReport period={period} />}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printable-report,
          .printable-report * {
            visibility: visible;
          }
          .printable-report {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function ReportCard({
  title,
  onExport,
  children,
}: {
  title: string;
  onExport?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {onExport && (
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-muted hover:text-foreground print:hidden"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            CSV
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 border-b border-border p-5 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label}>
          <p className="text-lg font-semibold text-foreground">{it.value}</p>
          <p className="mt-0.5 text-xs text-muted">{it.label}</p>
        </div>
      ))}
    </div>
  );
}

function FinanceReport({ period, locationId }: { period: Period; locationId: string }) {
  const [pnl, setPnl] = useState<ProfitAndLossDto | null>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    api.finance.pnl(from.toISOString(), to.toISOString(), locationId || undefined).then(setPnl).catch(() => {});
  }, [period, locationId]);

  if (!pnl) return <EmptyState />;

  return (
    <ReportCard
      title="Прибыли и убытки"
      onExport={() =>
        downloadCsv(
          `pnl-${period}.csv`,
          ["Товар", "Продано", "Выручка", "Себестоимость", "Валовая прибыль", "Маржа %"],
          pnl.byProduct.map((p) => [
            p.productName,
            formatQuantity(p.quantitySold),
            p.revenue.toFixed(2),
            p.hasCostData ? p.cogs.toFixed(2) : "нет данных",
            p.grossProfit.toFixed(2),
            p.marginPercent !== null ? p.marginPercent.toFixed(1) : "—",
          ]),
        )
      }
    >
      <StatRow
        items={[
          { label: "Выручка", value: formatMoney(pnl.revenue) },
          { label: "Себестоимость", value: formatMoney(pnl.cogs) },
          { label: "Валовая прибыль", value: formatMoney(pnl.grossProfit) },
          { label: "Операционная прибыль", value: formatMoney(pnl.operatingProfit) },
        ]}
      />
      <ReportTable
        columns={["Товар", "Продано", "Выручка", "Себестоимость", "Прибыль", "Маржа"]}
        rows={pnl.byProduct.map((p) => [
          p.productName,
          formatQuantity(p.quantitySold),
          formatMoney(p.revenue),
          p.hasCostData ? formatMoney(p.cogs) : "нет данных",
          formatMoney(p.grossProfit),
          p.marginPercent !== null ? `${p.marginPercent.toFixed(1)}%` : "—",
        ])}
      />
    </ReportCard>
  );
}

function SalesReport({
  period,
  locationId,
  isOrgWide,
}: {
  period: Period;
  locationId: string;
  isOrgWide: boolean;
}) {
  const [report, setReport] = useState<SalesReportDto | null>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    api.sales.report(from.toISOString(), to.toISOString(), locationId || undefined).then(setReport).catch(() => {});
  }, [period, locationId]);

  if (!report) return <EmptyState />;

  return (
    <div className="space-y-5">
      <ReportCard title="Продажи">
        <StatRow
          items={[
            { label: "Выручка", value: formatMoney(report.totalRevenue) },
            { label: "Продаж", value: String(report.totalCount) },
            {
              label: "Средний чек",
              value: report.totalCount > 0 ? formatMoney(report.totalRevenue / report.totalCount) : "—",
            },
            // Money given away on stale goods. Really a measure of
            // overproduction: a product reliably marked down is a product
            // being baked in the wrong quantity.
            { label: "Потери на уценке", value: formatMoney(report.markdownLoss) },
            {
              label: "Продано по уценке",
              value: report.markdownQuantity > 0 ? formatQuantity(report.markdownQuantity) : "—",
            },
          ]}
        />
      </ReportCard>

      {isOrgWide && (
        <ReportCard
          title="По точкам"
          onExport={() =>
            downloadCsv(
              `sales-by-location-${period}.csv`,
              ["Точка", "Выручка", "Продаж", "Средний чек"],
              report.byLocation.map((l) => [
                l.locationName,
                l.revenue.toFixed(2),
                l.count,
                l.count > 0 ? (l.revenue / l.count).toFixed(2) : "",
              ]),
            )
          }
        >
          {/* Средний чек per point, not just for the network. Two points can
              take the same money on very different numbers of buyers, and it
              is the per-point figure that says which. Divided here rather than
              on the server because both halves are already in this row. */}
          <ReportTable
            columns={["Точка", "Выручка", "Продаж", "Средний чек"]}
            rows={report.byLocation.map((l) => [
              l.locationName,
              formatMoney(l.revenue),
              String(l.count),
              l.count > 0 ? formatMoney(l.revenue / l.count) : "—",
            ])}
          />
        </ReportCard>
      )}

      <ReportCard
        title="По товарам"
        onExport={() =>
          downloadCsv(
            `sales-by-product-${period}.csv`,
            ["Товар", "Продано", "Выручка", "Из них по уценке", "Потери на уценке"],
            report.byProduct.map((p) => [
              p.productName,
              formatQuantity(p.quantity),
              p.revenue.toFixed(2),
              formatQuantity(p.markdownQuantity),
              p.markdownLoss.toFixed(2),
            ]),
          )
        }
      >
        <ReportTable
          columns={["Товар", "Продано", "Выручка", "Из них по уценке", "Потери на уценке"]}
          rows={report.byProduct.map((p) => [
            p.productName,
            formatQuantity(p.quantity),
            formatMoney(p.revenue),
            p.markdownQuantity > 0 ? formatQuantity(p.markdownQuantity) : "—",
            p.markdownLoss > 0 ? formatMoney(p.markdownLoss) : "—",
          ])}
        />
      </ReportCard>

      <SalesDemandCard period={period} locationId={locationId} />
    </div>
  );
}

function SalesDemandCard({ period, locationId }: { period: Period; locationId: string }) {
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState("");
  const [demand, setDemand] = useState<SalesDemandAnalysisDto | null>(null);

  useEffect(() => {
    api.customers.list().then(setCustomers).catch(() => {});
    api.categories.list().then(setCategories).catch(() => {});
    // A sale moves finished goods to a customer — raw materials aren't sold
    // directly, so they don't belong in this filter (same rule the sales
    // form itself already follows).
    api.products
      .list()
      .then((all) => setProducts(all.filter((p) => p.type === ProductType.FINISHED_GOOD)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const { from, to } = periodRange(period);
    api.sales
      .demand(from.toISOString(), to.toISOString(), {
        locationId: locationId || undefined,
        customerId: customerId || undefined,
        categoryId: categoryId || undefined,
        productId: productId || undefined,
      })
      .then(setDemand)
      .catch(() => {});
  }, [period, locationId, customerId, categoryId, productId]);

  const productsInCategory = categoryId ? products.filter((p) => p.categoryId === categoryId) : products;

  function handleCategoryChange(value: string) {
    setCategoryId(value);
    // Clear a product selection that no longer belongs to the new category
    // rather than silently keep filtering by a hidden productId.
    if (value && productId) {
      const stillValid = products.some((p) => p.id === productId && p.categoryId === value);
      if (!stillValid) setProductId("");
    }
  }

  // Only one breakdown is meaningful at a time: pick one product and see who
  // buys it, or pick one customer and see what they buy. With both filters
  // open, the product breakdown is the default (it's the main "сколько мы
  // продаём" question).
  const showByCustomer = Boolean(productId);
  const groupLabel = showByCustomer ? "Клиент" : "Товар";
  const rows: { label: string; quantity: number; avgPerDay: number | null; avgPerSale: number | null; revenue: number }[] =
    showByCustomer
      ? (demand?.byCustomer ?? []).map((r) => ({ label: r.customerName, ...r }))
      : (demand?.byProduct ?? []).map((r) => ({ label: r.productName, ...r }));

  return (
    <ReportCard
      title="Средний объём продаж"
      onExport={
        demand
          ? () =>
              downloadCsv(
                `sales-demand-${period}.csv`,
                [groupLabel, "Продано", "Среднее/день", "Среднее/продажу", "Выручка"],
                rows.map((r) => [
                  r.label,
                  formatQuantity(r.quantity),
                  r.avgPerDay !== null ? formatAverage(r.avgPerDay) : "—",
                  r.avgPerSale !== null ? formatAverage(r.avgPerSale) : "—",
                  r.revenue.toFixed(2),
                ]),
              )
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Все клиенты</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={categoryId}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Все товары</option>
          {productsInCategory.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <StatRow
        items={[
          { label: "Продано", value: demand ? formatQuantity(demand.summary.quantity) : "—" },
          {
            label: "Среднее в день",
            value: demand?.summary.avgPerDay != null ? formatAverage(demand.summary.avgPerDay) : "—",
          },
          {
            label: "Среднее за продажу",
            value: demand?.summary.avgPerSale != null ? formatAverage(demand.summary.avgPerSale) : "—",
          },
          { label: "Выручка", value: demand ? formatMoney(demand.summary.revenue) : "—" },
        ]}
      />

      <ReportTable
        columns={[groupLabel, "Продано", "Среднее/день", "Среднее/продажу", "Выручка"]}
        rows={rows.map((r) => [
          r.label,
          formatQuantity(r.quantity),
          r.avgPerDay !== null ? formatAverage(r.avgPerDay) : "—",
          r.avgPerSale !== null ? formatAverage(r.avgPerSale) : "—",
          formatMoney(r.revenue),
        ])}
      />
    </ReportCard>
  );
}

// How far back the trend chart looks. Deliberately its own control rather than
// the tab-level period switcher: that one is shared by all five report tabs,
// and this card is the only place that needs 3 months / a custom range.
type TrendPeriod = "today" | "7d" | "30d" | "month" | "3m" | "custom";

const TREND_PERIOD_LABELS: Record<TrendPeriod, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
  "3m": "3 месяца",
  custom: "Период",
};

function trendRange(period: TrendPeriod, customFrom: string, customTo: string): { from: Date; to: Date } | null {
  if (period === "custom") {
    if (!customFrom || !customTo) return null;
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
    return { from, to };
  }
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (period === "7d") from.setDate(from.getDate() - 6);
  if (period === "30d") from.setDate(from.getDate() - 29);
  if (period === "month") from.setDate(1);
  if (period === "3m") from.setMonth(from.getMonth() - 3);
  return { from, to };
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted">нет базы для сравнения</span>;
  const rounded = Math.round(pct * 10) / 10;
  const tone = rounded > 0 ? "text-emerald-600" : rounded < 0 ? "text-red-600" : "text-muted";
  const sign = rounded > 0 ? "+" : "";
  return (
    <span className={clsx("text-xs font-medium", tone)}>
      {sign}
      {rounded.toFixed(1).replace(".", ",")}%
    </span>
  );
}

// Динамика отгрузок ОДНОМУ клиенту. Deliberately requires picking a customer —
// with an "все клиенты" option this line would silently fold in walk-in retail
// (sales with no customer), which is a different question entirely.
function CustomerSalesTrendCard({ locationId }: { locationId: string }) {
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [period, setPeriod] = useState<TrendPeriod>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [metric, setMetric] = useState<TrendMetric>("quantity");
  const [trend, setTrend] = useState<SalesCustomerTrendDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.customers.list().then(setCustomers).catch(() => {});
  }, []);

  // Must be memoised: trendRange() calls new Date() for the relative periods,
  // so computing it plainly during render produced a different `to` on every
  // single render — which the fetch effect below depends on, so it re-fetched
  // in a tight loop and never left the "Загрузка…" state.
  const range = useMemo(() => trendRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const rangeFrom = range?.from.toISOString() ?? "";
  const rangeTo = range?.to.toISOString() ?? "";

  useEffect(() => {
    if (!customerId || !rangeFrom || !rangeTo) {
      setTrend(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    api.sales
      .customerTrend(customerId, rangeFrom, rangeTo, locationId || undefined)
      // Ignore a response that lost the race with a newer filter change,
      // otherwise a slow earlier request can overwrite fresher data.
      .then((data) => !cancelled && setTrend(data))
      .catch((err: unknown) => {
        if (cancelled) return;
        setTrend(null);
        // A failed request must never look like "честный ноль продаж" — that
        // was the actual bug behind an earlier report: a real server error
        // rendered the exact same "Нет данных за период" as a customer with
        // no sales, so a broken request was invisible.
        setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить данные");
      })
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [customerId, rangeFrom, rangeTo, locationId]);

  const isQuantity = metric === "quantity";
  // Summing quantity across products measured in different units (шт + кг)
  // produces a number that means nothing. Money never has this problem.
  const hasMixedUnits = (trend?.units.length ?? 0) > 1;

  return (
    <ReportCard
      title="Динамика продаж по клиенту"
      onExport={
        trend
          ? () =>
              downloadCsv(
                `customer-trend-${trend.customerName}-${period}.csv`,
                ["Дата", "Отгружено", "Сумма", "Продаж"],
                trend.points.map((p) => [p.date, formatQuantity(p.quantity), p.revenue.toFixed(2), p.salesCount]),
              )
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Выберите клиента</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
          {(Object.keys(TREND_PERIOD_LABELS) as TrendPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                period === p ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {TREND_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <span className="text-sm text-muted">—</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          {(["quantity", "revenue"] as TrendMetric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                metric === m ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {m === "quantity" ? "Шт." : "₸"}
            </button>
          ))}
        </div>
      </div>

      {!customerId ? (
        <p className="px-5 py-12 text-center text-sm text-muted">Выберите клиента, чтобы увидеть динамику отгрузок</p>
      ) : !range ? (
        <p className="px-5 py-12 text-center text-sm text-muted">Укажите начало и конец периода</p>
      ) : isLoading ? (
        <p className="px-5 py-12 text-center text-sm text-muted">Загрузка…</p>
      ) : loadError ? (
        <p className="px-5 py-12 text-center text-sm text-red-600">⚠️ {loadError}</p>
      ) : !trend ? (
        <p className="px-5 py-12 text-center text-sm text-muted">Нет данных за период</p>
      ) : (
        <>
          <StatRow
            items={[
              { label: "Итого отгружено", value: formatQuantity(trend.totalQuantity) },
              { label: "Итого продаж", value: formatMoney(trend.totalRevenue) },
              {
                label: "Среднее в день",
                value: isQuantity
                  ? trend.avgQuantityPerDay != null
                    ? formatAverage(trend.avgQuantityPerDay)
                    : "—"
                  : trend.avgRevenuePerDay != null
                    ? formatMoney(trend.avgRevenuePerDay)
                    : "—",
              },
              {
                label: "Лучший день",
                value: trend.bestDay
                  ? `${formatQuantity(trend.bestDay.quantity)} · ${formatDayKey(trend.bestDay.date)}`
                  : "—",
              },
            ]}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Худший день отгрузки:</span>
              <span className="text-xs font-medium text-foreground">
                {trend.worstDay
                  ? `${formatQuantity(trend.worstDay.quantity)} · ${formatDayKey(trend.worstDay.date)}`
                  : "—"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">К прошлому периоду:</span>
              <DeltaBadge pct={isQuantity ? trend.previous.quantityDeltaPct : trend.previous.revenueDeltaPct} />
              <span className="text-xs text-muted">
                (было {isQuantity ? formatQuantity(trend.previous.quantity) : formatMoney(trend.previous.revenue)})
              </span>
            </div>
          </div>

          {hasMixedUnits && (
            <div className="border-b border-border bg-amber-50 px-5 py-2.5 text-xs text-amber-800">
              Клиент берёт товары в разных единицах ({trend.units.map((u) => UNIT_LABELS_RU[u]).join(", ")}) — «Итого
              отгружено» складывает их в одно число. Для этого клиента опирайтесь на ₸.
            </div>
          )}

          <SalesTrendChart points={trend.points} metric={metric} />
        </>
      )}
    </ReportCard>
  );
}

function QualityReport({ period, locationId }: { period: Period; locationId: string }) {
  const [summary, setSummary] = useState<QualitySummaryDto | null>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    api.quality.summary(from.toISOString(), to.toISOString(), locationId || undefined).then(setSummary).catch(() => {});
  }, [period, locationId]);

  if (!summary) return <EmptyState />;

  return (
    <ReportCard
      title="Качество и списания"
      onExport={() =>
        downloadCsv(
          `quality-${period}.csv`,
          ["Причина", "Количество", "Сумма"],
          summary.byReason.map((r) => [WRITE_OFF_REASON_LABELS_RU[r.reason], formatQuantity(r.quantity), r.value.toFixed(2)]),
        )
      }
    >
      <StatRow
        items={[
          { label: "Списано на сумму", value: formatMoney(summary.totalValue) },
          { label: "Случаев списания", value: String(summary.totalMovements) },
        ]}
      />
      <ReportTable
        columns={["Причина", "Количество", "Сумма"]}
        rows={summary.byReason.map((r) => [WRITE_OFF_REASON_LABELS_RU[r.reason], formatQuantity(r.quantity), formatMoney(r.value)])}
      />
    </ReportCard>
  );
}

function HrReport({ period, locationId }: { period: Period; locationId: string }) {
  const [kpi, setKpi] = useState<HrKpiResponseDto | null>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    api.hr.kpi(from.toISOString(), to.toISOString(), locationId || undefined).then(setKpi).catch(() => {});
  }, [period, locationId]);

  if (!kpi) return <EmptyState />;

  return (
    <ReportCard
      title="KPI сотрудников"
      onExport={() =>
        downloadCsv(
          `hr-kpi-${period}.csv`,
          ["Сотрудник", "Продаж", "Выручка", "Партий", "Единиц произведено"],
          kpi.employees.map((e) => [
            e.userFullName,
            e.salesCount,
            e.salesRevenue.toFixed(2),
            e.batchesCompleted,
            formatQuantity(e.unitsProduced),
          ]),
        )
      }
    >
      <ReportTable
        columns={["Сотрудник", "Продаж", "Выручка", "Партий", "Единиц произведено"]}
        rows={kpi.employees.map((e) => [
          e.userFullName,
          String(e.salesCount),
          formatMoney(e.salesRevenue),
          String(e.batchesCompleted),
          formatQuantity(e.unitsProduced),
        ])}
      />
    </ReportCard>
  );
}

function StockReport({ locationId, isOrgWide }: { locationId: string; isOrgWide: boolean }) {
  const [levels, setLevels] = useState<StockLevelDto[] | null>(null);

  useEffect(() => {
    api.inventory.stockLevels(locationId || undefined).then(setLevels).catch(() => {});
  }, [locationId]);

  if (!levels) return <EmptyState />;

  return (
    <ReportCard
      title="Остатки склада"
      onExport={() =>
        downloadCsv(
          "stock-levels.csv",
          [...(isOrgWide ? ["Точка"] : []), "Товар", "Остаток", "Мин. остаток", "Низкий остаток"],
          levels.map((l) => [
            ...(isOrgWide ? [l.locationName] : []),
            l.productName,
            formatQuantity(l.quantity),
            formatQuantity(l.minQuantity),
            l.isLow ? "да" : "нет",
          ]),
        )
      }
    >
      <ReportTable
        columns={[...(isOrgWide ? ["Точка"] : []), "Товар", "Остаток", "Мин. остаток"]}
        rows={levels.map((l) => [
          ...(isOrgWide ? [l.locationName] : []),
          l.productName,
          formatQuantity(l.quantity),
          formatQuantity(l.minQuantity),
        ])}
        highlightRow={(i) => levels[i].isLow}
      />
    </ReportCard>
  );
}

// Picks a campaign first (a promotion has no meaningful "all campaigns"
// rollup — each one has its own coupons and category rules), then reports
// against it for the shared period control. Defaults to the most recently
// created promotion, which for a short pilot is almost always the one being
// watched.
function PromotionsReport({ period }: { period: Period }) {
  const [promotions, setPromotions] = useState<PromotionDto[]>([]);
  const [promotionId, setPromotionId] = useState("");
  const [report, setReport] = useState<PromotionReportDto | null>(null);

  useEffect(() => {
    api.promotions.list().then((list) => {
      setPromotions(list);
      if (!promotionId && list.length > 0) setPromotionId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!promotionId) return;
    const { from, to } = periodRange(period);
    api.promotions.report(promotionId, from.toISOString(), to.toISOString()).then(setReport).catch(() => setReport(null));
  }, [promotionId, period]);

  if (promotions.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted shadow-card">
        Акций пока нет — создайте кампанию в Настройках.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <select
        value={promotionId}
        onChange={(e) => setPromotionId(e.target.value)}
        className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        {promotions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {!report ? (
        <EmptyState />
      ) : (
        <ReportCard
          title={report.promotionName}
          onExport={() =>
            downloadCsv(
              `promotion-${report.promotionId}-${period}.csv`,
              ["Товар", "Количество", "Скидка", "Выручка после скидки"],
              report.topProducts.map((p) => [
                p.productName,
                formatQuantity(p.quantity),
                p.discountTotal.toFixed(2),
                p.revenueAfterDiscount.toFixed(2),
              ]),
            )
          }
        >
          <StatRow
            items={[
              { label: "Выдано купонов", value: String(report.couponsIssued) },
              { label: "Использовано", value: String(report.couponsRedeemed) },
              {
                label: "Конверсия",
                value: report.conversionPercent !== null ? `${report.conversionPercent.toFixed(1)}%` : "—",
              },
              { label: "Чеков по акции", value: String(report.receiptsCount) },
            ]}
          />
          <StatRow
            items={[
              { label: "Выручка до скидки", value: formatMoney(report.revenueBeforeDiscount) },
              { label: "Сумма скидок", value: formatMoney(report.discountTotal) },
              { label: "Выручка после скидки", value: formatMoney(report.revenueAfterDiscount) },
              { label: "Средний чек", value: report.averageTicket !== null ? formatMoney(report.averageTicket) : "—" },
            ]}
          />
          <StatRow
            items={[
              { label: "Себестоимость", value: formatMoney(report.cogs) },
              { label: "Валовая прибыль", value: formatMoney(report.grossProfit) },
            ]}
          />

          <div className="border-t border-border px-5 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Скидка по категориям</h3>
            <ReportTable
              columns={["Категория", "Количество", "Скидка"]}
              rows={report.discountByCategory.map((c) => [c.categoryName, formatQuantity(c.quantity), formatMoney(c.discountTotal)])}
            />
          </div>

          <div className="border-t border-border px-5 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Топ товаров по купону</h3>
            <ReportTable
              columns={["Товар", "Количество", "Скидка", "Выручка после скидки"]}
              rows={report.topProducts.map((p) => [
                p.productName,
                formatQuantity(p.quantity),
                formatMoney(p.discountTotal),
                formatMoney(p.revenueAfterDiscount),
              ])}
            />
          </div>
        </ReportCard>
      )}
    </div>
  );
}

function ReportTable({
  columns,
  rows,
  highlightRow,
}: {
  columns: string[];
  rows: (string | number)[][];
  highlightRow?: (index: number) => boolean;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted">Нет данных за период</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c} className="px-5 py-3 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i} className={highlightRow?.(i) ? "bg-amber-50" : undefined}>
              {row.map((cell, j) => (
                <td key={j} className={clsx("px-5 py-3", j === 0 ? "font-medium text-foreground" : "text-muted")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  return <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-muted shadow-card">Загрузка…</div>;
}

// ── Рентабельность: маржинальная прибыль по товарам + ABC ─────────────
//
// The sales report answers which products TURN OVER. This one answers which
// products EARN, which is a different ranking and usually a surprising one.
function ProfitabilityReport({ period, locationId }: { period: Period; locationId: string }) {
  const [report, setReport] = useState<ProductProfitabilityDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    setReport(null);
    setError(null);
    api.sales
      .profitability(from.toISOString(), to.toISOString(), locationId || undefined)
      .then(setReport)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить отчёт"),
      );
  }, [period, locationId]);

  if (error) return <ErrorState message={error} />;
  if (!report) return <EmptyState />;

  return (
    <div className="space-y-5">
      <ReportCard title="Маржинальная прибыль">
        <StatRow
          items={[
            { label: "Выручка", value: formatMoney(report.totalRevenue) },
            { label: "Себестоимость", value: formatMoney(report.totalCost) },
            { label: "Маржинальная прибыль", value: formatMoney(report.totalMargin) },
            {
              label: "Маржинальность",
              value: report.totalMarginPercent !== null ? `${report.totalMarginPercent.toFixed(1)}%` : "—",
            },
          ]}
        />
        {/* A data warning, not a lesson: it says how much of the period the
            margin above actually covers. Without it the totals look complete
            when they are not. */}
        {report.productsWithoutCostData > 0 && (
          <p className="border-b border-border bg-amber-50 px-5 py-3 text-sm text-amber-800">
            Не учтено: {report.productsWithoutCostData} товар(ов) без себестоимости на{" "}
            {formatMoney(report.revenueWithoutCostData)} выручки. Себестоимость берётся из техкарты
            или из фактических закупок — у этих товаров нет ни того, ни другого.
          </p>
        )}
      </ReportCard>

      <ReportCard
        title="По товарам"
        onExport={() =>
          downloadCsv(
            `profitability-${period}.csv`,
            [
              "Товар",
              "Продано",
              "Выручка",
              "Себестоимость",
              "Маржинальная прибыль",
              "Маржинальность, %",
              "Доля в выручке, %",
              "Доля в прибыли, %",
              "ABC",
            ],
            report.rows.map((r) => [
              r.productName,
              r.quantity,
              r.revenue.toFixed(2),
              r.hasCostData ? r.cost.toFixed(2) : "",
              r.hasCostData ? r.margin.toFixed(2) : "",
              r.marginPercent !== null ? r.marginPercent.toFixed(1) : "",
              r.hasCostData ? r.revenueShare.toFixed(1) : "",
              r.hasCostData ? r.marginShare.toFixed(1) : "",
              r.abcClass ?? "",
            ]),
          )
        }
      >
        <ReportTable
          columns={[
            "Товар",
            "Продано",
            "Выручка",
            "Себестоимость",
            "Маржинальная прибыль",
            "Маржинальность",
            "Доля в прибыли",
            "ABC",
          ]}
          rows={report.rows.map((r) => [
            r.productName,
            formatQuantity(r.quantity),
            formatMoney(r.revenue),
            r.hasCostData ? formatMoney(r.cost) : "нет данных",
            r.hasCostData ? formatMoney(r.margin) : "—",
            r.marginPercent !== null ? `${r.marginPercent.toFixed(1)}%` : "—",
            r.hasCostData ? `${r.marginShare.toFixed(1)}%` : "—",
            r.abcClass ?? "—",
          ])}
        />
      </ReportCard>

      {report.rows.some((r) => r.markdownQuantity > 0) && (
        <ReportCard title="Потери на уценке">
          <ReportTable
            columns={["Товар", "Продано по уценке", "Потеряно на уценке"]}
            rows={report.rows
              .filter((r) => r.markdownQuantity > 0)
              .sort((a, b) => b.markdownLoss - a.markdownLoss)
              .map((r) => [r.productName, formatQuantity(r.markdownQuantity), formatMoney(r.markdownLoss)])}
          />
        </ReportCard>
      )}
    </div>
  );
}

// ── Динамика продаж: по дням, часам и дням недели ─────────────────────
function DynamicsReport({ period, locationId }: { period: Period; locationId: string }) {
  const [report, setReport] = useState<SalesDynamicsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    setReport(null);
    setError(null);
    api.sales
      .dynamics(from.toISOString(), to.toISOString(), locationId || undefined)
      .then(setReport)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить отчёт"),
      );
  }, [period, locationId]);

  if (error) return <ErrorState message={error} />;
  if (!report) return <EmptyState />;

  const delta = (value: number | null) =>
    value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

  return (
    <div className="space-y-5">
      <ReportCard title="Выручка по дням">
        <StatRow
          items={[
            { label: "Выручка", value: formatMoney(report.totalRevenue) },
            { label: "Продаж", value: String(report.totalSalesCount) },
            {
              label: "Средний чек",
              value: report.averageTicket !== null ? formatMoney(report.averageTicket) : "—",
            },
            {
              label: "Среднее в день",
              value:
                report.averageRevenuePerDay !== null ? formatMoney(report.averageRevenuePerDay) : "—",
            },
          ]}
        />
        <StatRow
          items={[
            { label: "К прошлому периоду", value: delta(report.previous.revenueDeltaPct) },
            { label: "Выручка ранее", value: formatMoney(report.previous.revenue) },
            {
              label: "Лучший день",
              value: report.bestDay
                ? `${formatDayKey(report.bestDay.date)} — ${formatMoney(report.bestDay.revenue)}`
                : "—",
            },
            {
              label: "Худший день",
              value: report.worstDay
                ? `${formatDayKey(report.worstDay.date)} — ${formatMoney(report.worstDay.revenue)}`
                : "—",
            },
          ]}
        />
        <RevenueTrendChart points={report.points} />
      </ReportCard>

      <ReportCard title="Выручка по часам">
        <HourlyRevenueChart buckets={report.byHour} />
      </ReportCard>

      <ReportCard
        title="Выручка по дням недели"
        onExport={() =>
          downloadCsv(
            `revenue-by-weekday-${period}.csv`,
            ["День недели", "Выручка", "Продаж", "Таких дней в периоде", "В среднем за день"],
            report.byWeekday.map((d) => [
              ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"][d.weekday - 1],
              d.revenue.toFixed(2),
              d.salesCount,
              d.occurrences,
              d.averageRevenue !== null ? d.averageRevenue.toFixed(2) : "",
            ]),
          )
        }
      >
        <WeekdayRevenueChart buckets={report.byWeekday} />
      </ReportCard>

      <SalesHistoryTable report={report} period={period} />
    </div>
  );
}

// ── История: те же продажи числами, по дням / неделям / месяцам ───────
//
// The charts above show the shape; this shows the numbers, because "сколько
// было продаж вчера" is a question with an exact answer and reading it off a
// line chart is not it.
//
// Grouped from the daily points the server already returns rather than by
// asking it again — every bucket here is a sum of whole calendar days it has
// already bucketed in Asia/Almaty, so the week and month totals cannot drift
// from the day totals or from any other report.
type Grouping = "day" | "week" | "month";

const GROUPING_LABELS: Record<Grouping, string> = {
  day: "По дням",
  week: "По неделям",
  month: "По месяцам",
};

// Monday of the week a "YYYY-MM-DD" key falls in, as another such key. Stepped
// in UTC on a plain calendar date, never on a zoned instant, so it cannot slip
// a day around an offset change — the same rule the server buckets by.
function mondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (isoDay - 1));
  return date.toISOString().slice(0, 10);
}

const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

function shortDayKey(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${day}.${month}`;
}

interface HistoryRow {
  key: string;
  label: string;
  revenue: number;
  salesCount: number;
}

function groupPoints(points: SalesDynamicsDto["points"], grouping: Grouping): HistoryRow[] {
  const buckets = new Map<string, HistoryRow>();
  for (const point of points) {
    let key: string;
    let label: string;
    if (grouping === "day") {
      key = point.date;
      label = formatDayKey(point.date);
    } else if (grouping === "week") {
      key = mondayOf(point.date);
      label = `${shortDayKey(key)} — ${shortDayKey(addDaysKey(key, 6))}`;
    } else {
      key = point.date.slice(0, 7);
      const [y, m] = key.split("-").map(Number);
      label = monthFormatter.format(new Date(Date.UTC(y, m - 1, 1)));
    }
    const row = buckets.get(key) ?? { key, label, revenue: 0, salesCount: 0 };
    row.revenue += point.revenue;
    row.salesCount += point.salesCount;
    buckets.set(key, row);
  }
  // Newest first: the question being answered is almost always about the most
  // recent day or week, and it should not need scrolling to.
  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function SalesHistoryTable({ report, period }: { report: SalesDynamicsDto; period: Period }) {
  const [grouping, setGrouping] = useState<Grouping>("day");
  const rows = useMemo(() => groupPoints(report.points, grouping), [report.points, grouping]);

  // A day with no sales is kept over a short period — "в этот день ничего не
  // продали" is a real answer, and over a week or a month there are few enough
  // of them to read. Over a quarter or a year it is the opposite: sixty empty
  // rows bury the handful that carry numbers, so they are dropped and the
  // table says so rather than looking like days went missing.
  const ZERO_ROW_LIMIT = 31;
  const hidesEmptyDays = grouping === "day" && rows.length > ZERO_ROW_LIMIT;
  const visible =
    grouping === "day" && !hidesEmptyDays ? rows : rows.filter((r) => r.salesCount > 0);

  return (
    <ReportCard
      title="История продаж"
      onExport={() =>
        downloadCsv(
          `sales-history-${grouping}-${period}.csv`,
          ["Период", "Выручка", "Продаж", "Средний чек"],
          visible.map((r) => [
            r.label,
            r.revenue.toFixed(2),
            r.salesCount,
            r.salesCount > 0 ? (r.revenue / r.salesCount).toFixed(2) : "",
          ]),
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-5 py-3 print:hidden">
        {(Object.keys(GROUPING_LABELS) as Grouping[]).map((g) => (
          <button
            key={g}
            onClick={() => setGrouping(g)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              grouping === g ? "bg-surface-muted text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {GROUPING_LABELS[g]}
          </button>
        ))}
      </div>
      <ReportTable
        columns={["Период", "Выручка", "Продаж", "Средний чек"]}
        rows={visible.map((r) => [
          r.label,
          formatMoney(r.revenue),
          String(r.salesCount),
          r.salesCount > 0 ? formatMoney(r.revenue / r.salesCount) : "—",
        ])}
      />
      {hidesEmptyDays && (
        <p className="border-t border-border px-5 py-3 text-sm text-muted">
          Дни без продаж скрыты — их {rows.length - visible.length} за период.
        </p>
      )}
    </ReportCard>
  );
}

// ── ДДС: движение денежных средств ────────────────────────────────────
function CashFlowReport({ period }: { period: Period }) {
  const [report, setReport] = useState<CashFlowDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    setReport(null);
    setError(null);
    api.finance
      .cashFlow(from.toISOString(), to.toISOString())
      .then(setReport)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить отчёт"),
      );
  }, [period]);

  if (error) return <ErrorState message={error} />;
  if (!report) return <EmptyState />;

  return (
    <div className="space-y-5">
      <ReportCard title="Денежный поток">
        <StatRow
          items={[
            { label: "Остаток на начало", value: formatMoney(report.openingBalance) },
            { label: "Поступления", value: formatMoney(report.totalInflow) },
            { label: "Выплаты", value: formatMoney(report.totalOutflow) },
            { label: "Остаток на конец", value: formatMoney(report.closingBalance) },
          ]}
        />
        <StatRow items={[{ label: "Чистый денежный поток", value: formatMoney(report.netFlow) }]} />
      </ReportCard>

      <ReportCard title="Поступления">
        <ReportTable
          columns={["Статья", "Сумма", "Операций"]}
          rows={report.inflowByType.map((l) => [l.label, formatMoney(l.amount), String(l.count)])}
        />
      </ReportCard>

      <ReportCard title="Выплаты">
        <ReportTable
          columns={["Статья", "Сумма", "Операций"]}
          rows={report.outflowByType.map((l) => [l.label, formatMoney(l.amount), String(l.count)])}
        />
      </ReportCard>

      <ReportCard
        title="Выплаты по категориям"
        onExport={() =>
          downloadCsv(
            `cash-outflow-by-category-${period}.csv`,
            ["Категория", "Сумма", "Операций"],
            report.outflowByCategory.map((c) => [c.categoryName, c.amount.toFixed(2), c.count]),
          )
        }
      >
        <ReportTable
          columns={["Категория", "Сумма", "Операций"]}
          rows={report.outflowByCategory.map((c) => [c.categoryName, formatMoney(c.amount), String(c.count)])}
        />
        {/* Same kind of data warning as the profitability card: without it the
            category breakdown reads as the whole of the spending. */}
        {report.uncategorizedOutflow > 0 && (
          <p className="border-t border-border bg-amber-50 px-5 py-3 text-sm text-amber-800">
            Без категории: {formatMoney(report.uncategorizedOutflow)}. Эти выплаты не попали ни в одну
            строку выше.
          </p>
        )}
      </ReportCard>
    </div>
  );
}

// A failed request must never look like a genuine empty result — see the
// customer-trend card, where a stale-backend 404 rendered as the same quiet
// "нет данных" a real zero would.
function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-10 text-center shadow-card">
      <p className="text-sm text-red-600">{message}</p>
    </div>
  );
}
