"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  SalesDynamicsPointDto,
  SalesHourBucketDto,
  SalesWeekdayBucketDto,
} from "@bakery-os/shared";
import { formatDayKey, formatMoney } from "@/lib/format";

// Charts for the whole business's takings, alongside the per-customer line
// chart in sales-trend-chart.tsx. Same two rules as that one, and for the same
// reasons: recharts measures the DOM, so it mounts only on the client or the
// server render disagrees with the first client one; and every colour comes
// from a CSS custom property rather than a hex, so a brand-colour change in
// globals.css reaches the charts too.
function useClientMounted(): boolean {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  return isMounted;
}

const compactMoney = (v: number) => new Intl.NumberFormat("ru-RU", { notation: "compact" }).format(v);

// "2026-08-22" -> "22.08". Parsed by parts rather than through Date, so the
// label cannot drift a day from the date the server already bucketed.
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}`;
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload: SalesDynamicsPointDto }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
      <p className="text-xs font-medium text-foreground">{formatDayKey(point.date)}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{formatMoney(point.revenue)}</p>
      <p className="text-sm text-muted">{point.salesCount} продаж</p>
      {point.averageTicket !== null && (
        <p className="text-xs text-muted">Средний чек {formatMoney(point.averageTicket)}</p>
      )}
      {point.salesCount === 0 && <p className="mt-1 text-xs text-muted">Продаж не было</p>}
    </div>
  );
}

export function RevenueTrendChart({ points }: { points: SalesDynamicsPointDto[] }) {
  const isMounted = useClientMounted();
  if (points.length === 0) {
    return <p className="px-5 py-12 text-center text-sm text-muted">Нет данных за период</p>;
  }
  if (!isMounted) return <div className="h-72 w-full" />;

  return (
    <div className="h-72 w-full px-2 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--border)"
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--border)"
            width={56}
            tickFormatter={compactMoney}
          />
          <Tooltip content={<DayTooltip />} cursor={{ stroke: "var(--border)" }} />
          <Line
            type="monotone"
            dataKey="revenue"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 2.5, fill: "var(--accent)" }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BucketTooltip({
  active,
  payload,
  caption,
}: {
  active?: boolean;
  payload?: { payload: { label: string; value: number; salesCount: number } }[];
  caption: string;
}) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
      <p className="text-xs font-medium text-foreground">{bucket.label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{formatMoney(bucket.value)}</p>
      <p className="text-xs text-muted">{caption}</p>
      <p className="text-xs text-muted">{bucket.salesCount} продаж</p>
    </div>
  );
}

export function HourlyRevenueChart({ buckets }: { buckets: SalesHourBucketDto[] }) {
  const isMounted = useClientMounted();
  // Every hour of the day, including the closed ones. A gap at 3am is
  // information — it is what makes the trading hours visible as a shape.
  const data = buckets.map((b) => ({
    label: `${String(b.hour).padStart(2, "0")}:00`,
    value: b.revenue,
    salesCount: b.salesCount,
  }));
  if (!isMounted) return <div className="h-64 w-full" />;

  return (
    <div className="h-64 w-full px-2 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--muted)", fontSize: 10 }}
            stroke="var(--border)"
            interval={1}
          />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--border)"
            width={56}
            tickFormatter={compactMoney}
          />
          <Tooltip
            content={<BucketTooltip caption="за период" />}
            cursor={{ fill: "var(--border)", fillOpacity: 0.35 }}
          />
          <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function WeekdayRevenueChart({ buckets }: { buckets: SalesWeekdayBucketDto[] }) {
  const isMounted = useClientMounted();
  // Charted as the AVERAGE per occurrence, not the total. A period with five
  // Mondays and four Tuesdays would otherwise make Monday look like the better
  // day purely because there was more Monday in it.
  const data = buckets.map((b) => ({
    label: WEEKDAY_LABELS[b.weekday - 1],
    value: b.averageRevenue ?? 0,
    salesCount: b.salesCount,
  }));
  if (!isMounted) return <div className="h-64 w-full" />;

  return (
    <div className="h-64 w-full px-2 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} stroke="var(--border)" />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--border)"
            width={56}
            tickFormatter={compactMoney}
          />
          <Tooltip
            content={<BucketTooltip caption="в среднем за такой день" />}
            cursor={{ fill: "var(--border)", fillOpacity: 0.35 }}
          />
          <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
