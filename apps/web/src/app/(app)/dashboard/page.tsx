"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Banknote, Building2, Croissant, HandCoins, MapPin, Receipt, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";
import type { DashboardFinanceDto, DashboardPeriodFiguresDto, DashboardSummaryDto, DirectionDto, LocationDto } from "@bakery-os/shared";
import { FINANCE_VIEW_ROLES, LOCATION_TYPE_LABELS_RU, ORG_WIDE_ROLES } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney, formatQuantity } from "@/lib/format";

export default function DashboardPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const seesFinance = user ? FINANCE_VIEW_ROLES.includes(user.role) : false;
  const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
  const [money, setMoney] = useState<DashboardFinanceDto | null>(null);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationId, setLocationId] = useState("");
  const [directionId, setDirectionId] = useState("");
  const [directions, setDirections] = useState<DirectionDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOrgWide) api.locations.list().then(setLocations).catch(() => {});
  }, [isOrgWide]);

  useEffect(() => {
    if (seesFinance) api.directions.list().then(setDirections).catch(() => {});
  }, [seesFinance]);

  useEffect(() => {
    setError(null);
    api
      .dashboardSummary(locationId || undefined)
      .then(setSummary)
      .catch(() => setError("Не удалось загрузить данные дашборда"));
    if (seesFinance) {
      setMoney(null);
      api
        .dashboardFinance(locationId || undefined, directionId || undefined)
        .then(setMoney)
        .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить финансовые показатели"));
    }
  }, [locationId, directionId, seesFinance]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Здравствуйте, {user?.fullName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">Обзор сети {summary?.organizationName ?? ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {seesFinance && directions.length > 0 && (
          <select
            value={directionId}
            onChange={(e) => setDirectionId(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            aria-label="Направление"
          >
            <option value="">Все направления</option>
            {directions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        {isOrgWide && (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Вся сеть</option>
            {locations
              .filter((l) => l.isActive !== false)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {seesFinance ? (
        <FinanceBlock money={money} lowStockCount={summary?.lowStockCount ?? null} />
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={Wallet} label="Выручка сегодня" value={formatMoney(summary?.todayRevenue ?? 0)} />
          <StatCard icon={TrendingUp} label="Выручка за 7 дней" value={formatMoney(summary?.last7DaysRevenue ?? 0)} />
          <Link href="/inventory">
            <StatCard
              icon={AlertTriangle}
              label="Товаров с низким остатком"
              value={summary?.lowStockCount ?? "—"}
              tone={summary && summary.lowStockCount > 0 ? "warning" : "default"}
            />
          </Link>
        </div>
      )}

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

const percent = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

function FinanceBlock({ money, lowStockCount }: { money: DashboardFinanceDto | null; lowStockCount: number | null }) {
  const periods: [string, DashboardPeriodFiguresDto | undefined][] = [
    ["Сегодня", money?.today],
    ["7 дней", money?.week],
    ["Месяц", money?.month],
  ];
  return (
    <>
      <div className="mb-4 overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-5 py-3 font-medium" />
              {periods.map(([label]) => (
                <th key={label} className="px-5 py-3 text-right font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(
              [
                ["Выручка", (p: DashboardPeriodFiguresDto) => formatMoney(p.netRevenue)],
                ["Валовая прибыль", (p: DashboardPeriodFiguresDto) => formatMoney(p.grossProfit)],
                ["Валовая маржа", (p: DashboardPeriodFiguresDto) => percent(p.grossMarginPercent)],
              ] as const
            ).map(([label, value]) => (
              <tr key={label}>
                <td className="px-5 py-3 text-muted">{label}</td>
                {periods.map(([key, p]) => (
                  <td key={key} className="px-5 py-3 text-right text-lg font-semibold text-foreground">
                    {p ? value(p) : "…"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/finance?tab=bank" title={money?.cashAccounts.map((a) => `${a.name}: ${formatMoney(a.balance)}`).join("\n")}>
          <StatCard icon={Banknote} label="Денежные средства" value={money ? formatMoney(money.cashTotal) : "…"} />
        </Link>
        <Link href="/finance?tab=receivables">
          <StatCard
            icon={HandCoins}
            label="Дебиторская задолженность"
            value={money ? formatMoney(money.receivables.total) : "…"}
            sub={money && money.receivables.overdue > 0 ? `просрочено ${formatMoney(money.receivables.overdue)}` : undefined}
            tone={money && money.receivables.overdue > 0 ? "warning" : "default"}
          />
        </Link>
        <Link href="/finance?tab=payables">
          <StatCard
            icon={Receipt}
            label="Кредиторская задолженность"
            value={money ? formatMoney(money.payables.total) : "…"}
            sub={money && money.payables.overdue > 0 ? `просрочено ${formatMoney(money.payables.overdue)}` : undefined}
            tone={money && money.payables.overdue > 0 ? "warning" : "default"}
          />
        </Link>
        <Link href="/inventory">
          <StatCard
            icon={Croissant}
            label="Готовая продукция в кондитерских"
            value={money ? formatMoney(money.finishedGoods.atCost) : "…"}
            sub={money ? `по цене продажи ${formatMoney(money.finishedGoods.atSalePrice)}` : undefined}
          />
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface shadow-card lg:col-span-2">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Топ-5 позиций за месяц</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-5 py-2 font-medium">Позиция</th>
                <th className="px-5 py-2 text-right font-medium">Кол-во</th>
                <th className="px-5 py-2 text-right font-medium">Выручка</th>
                <th className="px-5 py-2 text-right font-medium">Валовая прибыль</th>
                <th className="px-5 py-2 text-right font-medium">Маржа</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {money?.topProducts.map((p) => (
                <tr key={p.productId}>
                  <td className="px-5 py-2 text-foreground">{p.productName}</td>
                  <td className="px-5 py-2 text-right text-muted">{formatQuantity(p.quantitySold)}</td>
                  <td className="px-5 py-2 text-right text-foreground">{formatMoney(p.revenue)}</td>
                  <td className="px-5 py-2 text-right text-foreground">{formatMoney(p.grossProfit)}</td>
                  <td className="px-5 py-2 text-right text-muted">{percent(p.marginPercent)}</td>
                </tr>
              ))}
              {money && money.topProducts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-muted">
                    Продаж в этом месяце нет
                  </td>
                </tr>
              )}
              {!money && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-muted">
                    Загрузка…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Link href="/inventory">
          <StatCard
            icon={AlertTriangle}
            label="Товаров с низким остатком"
            value={lowStockCount ?? "—"}
            tone={lowStockCount ? "warning" : "default"}
          />
        </Link>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  sub?: string;
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
      {sub && <p className={`mt-1 text-xs ${tone === "warning" ? "text-amber-700" : "text-muted"}`}>{sub}</p>}
    </div>
  );
}
