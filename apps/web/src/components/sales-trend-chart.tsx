"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SalesCustomerTrendPointDto } from "@bakery-os/shared";
import { formatDayKey, formatMoney, formatQuantity } from "@/lib/format";

export type TrendMetric = "quantity" | "revenue";

// "2026-08-22" -> "22.08". Parsed by parts rather than through Date, so the
// label can't drift a day from the date the server already bucketed.
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}`;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: SalesCustomerTrendPointDto }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-card">
      <p className="text-xs font-medium text-foreground">{formatDayKey(point.date)}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{formatQuantity(point.quantity)} ед.</p>
      <p className="text-sm text-foreground">{formatMoney(point.revenue)}</p>
      {point.salesCount === 0 && <p className="mt-1 text-xs text-muted">Отгрузок не было</p>}
    </div>
  );
}

export function SalesTrendChart({
  points,
  metric,
}: {
  points: SalesCustomerTrendPointDto[];
  metric: TrendMetric;
}) {
  // Recharts measures the DOM to size itself, so it renders nothing useful on
  // the server. Mounting it only on the client keeps the server and first
  // client render identical instead of producing a hydration mismatch.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

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
            width={metric === "revenue" ? 72 : 44}
            tickFormatter={(v: number) =>
              metric === "revenue" ? new Intl.NumberFormat("ru-RU").format(v) : formatQuantity(v)
            }
          />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--border)" }} />
          <Line
            type="monotone"
            dataKey={metric}
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
