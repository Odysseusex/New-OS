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
  ProfitAndLossDto,
  QualitySummaryDto,
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
  ProductType,
  QUALITY_VIEW_ROLES,
  UNIT_LABELS_RU,
  WRITE_OFF_REASON_LABELS_RU,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv } from "@/lib/csv";
import { formatAverage, formatDayKey, formatMoney, formatQuantity } from "@/lib/format";
import { SalesTrendChart, type TrendMetric } from "@/components/sales-trend-chart";

type ReportKey = "finance" | "sales" | "trend" | "quality" | "hr" | "stock";
type Period = "today" | "7d" | "30d" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
};

function periodRange(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (period === "7d") from.setDate(from.getDate() - 6);
  if (period === "30d") from.setDate(from.getDate() - 29);
  if (period === "month") from.setDate(1);
  return { from, to };
}

export default function ReportsPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;

  const availableReports: { key: ReportKey; label: string }[] = [
    ...(user && FINANCE_VIEW_ROLES.includes(user.role) ? [{ key: "finance" as const, label: "Финансы (P&L)" }] : []),
    { key: "sales" as const, label: "Продажи" },
    // Needs a customer to be picked, and the customer list is gated on
    // CUSTOMER_VIEW_ROLES — without them the tab could only ever show an
    // empty dropdown.
    ...(user && CUSTOMER_VIEW_ROLES.includes(user.role) ? [{ key: "trend" as const, label: "Динамика" }] : []),
    ...(user && QUALITY_VIEW_ROLES.includes(user.role)
      ? [{ key: "quality" as const, label: "Качество и списания" }]
      : []),
    ...(user && HR_MANAGE_ROLES.includes(user.role) ? [{ key: "hr" as const, label: "Персонал (KPI)" }] : []),
    { key: "stock" as const, label: "Остатки склада" },
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
            <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
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
        {activeReport === "trend" && <CustomerSalesTrendCard locationId={locationFilter} />}
        {activeReport === "quality" && <QualityReport period={period} locationId={locationFilter} />}
        {activeReport === "hr" && <HrReport period={period} locationId={locationFilter} />}
        {activeReport === "stock" && <StockReport locationId={locationFilter} isOrgWide={isOrgWide} />}
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
          ]}
        />
      </ReportCard>

      {isOrgWide && (
        <ReportCard
          title="По точкам"
          onExport={() =>
            downloadCsv(
              `sales-by-location-${period}.csv`,
              ["Точка", "Выручка", "Продаж"],
              report.byLocation.map((l) => [l.locationName, l.revenue.toFixed(2), l.count]),
            )
          }
        >
          <ReportTable
            columns={["Точка", "Выручка", "Продаж"]}
            rows={report.byLocation.map((l) => [l.locationName, formatMoney(l.revenue), String(l.count)])}
          />
        </ReportCard>
      )}

      <ReportCard
        title="По товарам"
        onExport={() =>
          downloadCsv(
            `sales-by-product-${period}.csv`,
            ["Товар", "Продано", "Выручка"],
            report.byProduct.map((p) => [p.productName, formatQuantity(p.quantity), p.revenue.toFixed(2)]),
          )
        }
      >
        <ReportTable
          columns={["Товар", "Продано", "Выручка"]}
          rows={report.byProduct.map((p) => [p.productName, formatQuantity(p.quantity), formatMoney(p.revenue)])}
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
