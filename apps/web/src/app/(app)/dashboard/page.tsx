"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, MapPin, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";
import type { DashboardSummaryDto } from "@bakery-os/shared";
import { LOCATION_TYPE_LABELS_RU } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/format";

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboardSummary()
      .then(setSummary)
      .catch(() => setError("Не удалось загрузить данные дашборда"));
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">
          Здравствуйте, {user?.fullName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted">Обзор сети {summary?.organizationName ?? ""}</p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Wallet} label="Выручка сегодня" value={formatMoney(summary?.todayRevenue ?? 0)} />
        <StatCard
          icon={TrendingUp}
          label="Выручка за 7 дней"
          value={formatMoney(summary?.last7DaysRevenue ?? 0)}
        />
        <Link href="/inventory">
          <StatCard
            icon={AlertTriangle}
            label="Товаров с низким остатком"
            value={summary?.lowStockCount ?? "—"}
            tone={summary && summary.lowStockCount > 0 ? "warning" : "default"}
          />
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Building2} label="Точек в сети" value={summary?.locationsCount ?? "—"} />
        <StatCard icon={MapPin} label="Регионов" value={summary?.regionsCount ?? "—"} />
        <StatCard icon={Users} label="Сотрудников в системе" value={summary?.usersCount ?? "—"} />
      </div>

      <div className="mb-8 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-foreground">AI-центр скоро здесь</h2>
        </div>
        <p className="text-sm text-muted">
          По мере накопления истории продаж, склада и производства здесь появятся
          рекомендации: прогноз спроса, обнаружение аномалий и еженедельные сводки для
          владельца.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Точки сети</h2>
        </div>
        <ul className="divide-y divide-border">
          {summary?.locations.map((loc) => (
            <li key={loc.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{loc.name}</p>
                <p className="text-xs text-muted">
                  {loc.city}, {loc.address}
                </p>
              </div>
              <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted">
                {LOCATION_TYPE_LABELS_RU[loc.type]}
              </span>
            </li>
          ))}
          {!summary && (
            <li className="px-5 py-6 text-center text-sm text-muted">Загрузка…</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  tone?: "default" | "warning";
}) {
  return (
    <div className="h-full rounded-2xl border border-border bg-surface p-5 shadow-card transition hover:border-accent/40">
      <div
        className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${
          tone === "warning" ? "bg-amber-50 text-amber-600" : "bg-surface-muted text-accent"
        }`}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </div>
  );
}
