"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  NOT_CONFIGURED_ITEM_LABELS_RU,
  NotConfiguredItem,
  PLAN_METRIC_LABELS_RU,
  PLANNING_MANAGE_ROLES,
  PLANNING_VIEW_ROLES,
  PlanMetric,
} from "@bakery-os/shared";
import type {
  AbcXyzReportDto,
  ForecastDto,
  ModelDriversDto,
  PlanFactDto,
  ReplenishmentReportDto,
  ScenarioComparisonDto,
  ScenarioDto,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney, formatQuantity } from "@/lib/format";

type Tab = "abc" | "replenishment" | "planfact" | "model";

const TABS: { id: Tab; label: string }[] = [
  { id: "abc", label: "ABC / XYZ" },
  { id: "replenishment", label: "Пополнение запасов" },
  { id: "planfact", label: "План / Факт" },
  { id: "model", label: "Финансовая модель" },
];

const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const field =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));

export default function PlanningPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("abc");
  const canView = user ? PLANNING_VIEW_ROLES.includes(user.role) : false;

  if (user && !canView) {
    return <p className="text-sm text-muted">Раздел доступен руководителям и бухгалтерии</p>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Планирование</h1>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
              tab === t.id ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "abc" && <AbcXyzView />}
      {tab === "replenishment" && <ReplenishmentView />}
      {tab === "planfact" && <PlanFactView canManage={user ? PLANNING_MANAGE_ROLES.includes(user.role) : false} />}
      {tab === "model" && <ModelView canManage={user ? PLANNING_MANAGE_ROLES.includes(user.role) : false} />}
    </div>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    load()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить данные"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, setData };
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl border border-border bg-surface shadow-card">
      {title && (
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
}

const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={clsx("px-5 py-3 font-medium", right && "text-right")}>{children}</th>
);

// ── ABC / XYZ ──────────────────────────────────────────────────────────

function AbcXyzView() {
  const { data, error } = useLoad<AbcXyzReportDto>(() => api.planning.abcXyz(), []);
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Загрузка…</p>;
  return (
    <>
      <Card title="Матрица ABC × XYZ">
        <div className="grid grid-cols-4 gap-px bg-border text-sm">
          <div className="bg-surface-muted px-4 py-2" />
          {["X", "Y", "Z", "?"].map((x) => (
            <div key={x} className="bg-surface-muted px-4 py-2 text-center font-medium text-muted">
              {x === "?" ? "Без класса" : x}
            </div>
          ))}
          {["A", "B", "C"].map((a) => (
            <div key={a} className="contents">
              <div className="bg-surface-muted px-4 py-3 font-medium text-muted">{a}</div>
              {["X", "Y", "Z", "?"].map((x) => (
                <div key={a + x} className="bg-surface px-4 py-3 text-center text-foreground">
                  {data.matrix[a + x] ?? 0}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="px-5 py-3 text-xs text-muted">
          Недель в анализе: {data.weeks} · A до {data.thresholds.aShare}% выручки, B до {data.thresholds.bShare}% · X ≤ {data.thresholds.xCv}%, Y ≤ {data.thresholds.yCv}% вариации
        </p>
      </Card>
      <Card title="Товары">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <Th>Товар</Th>
              <Th right>Продано</Th>
              <Th right>Выручка</Th>
              <Th right>Доля</Th>
              <Th right>Накоп.</Th>
              <Th>ABC</Th>
              <Th>XYZ</Th>
              <Th right>Вариация</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((r) => (
              <tr key={r.productId}>
                <td className="px-5 py-2.5 font-medium text-foreground">{r.productName}</td>
                <td className="px-5 py-2.5 text-right text-muted">{formatQuantity(r.quantity)}</td>
                <td className="px-5 py-2.5 text-right">{formatMoney(r.revenue)}</td>
                <td className="px-5 py-2.5 text-right text-muted">{r.share}%</td>
                <td className="px-5 py-2.5 text-right text-muted">{r.cumulativeShare}%</td>
                <td className="px-5 py-2.5">{r.abcClass}</td>
                <td className="px-5 py-2.5">{r.xyzClass ?? "—"}</td>
                <td className="px-5 py-2.5 text-right text-muted">{r.coefficientOfVariation === null ? "—" : `${r.coefficientOfVariation}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

// ── replenishment ──────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  BELOW_MIN: "bg-red-50 text-red-700",
  REORDER: "bg-amber-50 text-amber-700",
  OK: "bg-green-50 text-green-700",
  NO_DEMAND: "bg-surface-muted text-muted",
};
const STATUS_LABEL: Record<string, string> = {
  BELOW_MIN: "Ниже минимума",
  REORDER: "Пора заказывать",
  OK: "В норме",
  NO_DEMAND: "Нет спроса",
};

function ReplenishmentView() {
  const [lead, setLead] = useState("2");
  const [safety, setSafety] = useState("1");
  const [review, setReview] = useState("7");
  const [stated, setStated] = useState(false);
  const { data, error } = useLoad<ReplenishmentReportDto>(
    () =>
      api.planning.replenishment(stated ? { leadTimeDays: num(lead), safetyDays: num(safety), reviewDays: num(review) } : {}),
    [stated, lead, safety, review],
  );
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Labeled label="Срок поставки, дн.">
          <input className={clsx(field, "w-28")} inputMode="decimal" value={lead} onChange={(e) => { setLead(e.target.value); setStated(true); }} />
        </Labeled>
        <Labeled label="Страховой запас, дн.">
          <input className={clsx(field, "w-28")} inputMode="decimal" value={safety} onChange={(e) => { setSafety(e.target.value); setStated(true); }} />
        </Labeled>
        <Labeled label="Цикл заказа, дн.">
          <input className={clsx(field, "w-28")} inputMode="decimal" value={review} onChange={(e) => { setReview(e.target.value); setStated(true); }} />
        </Labeled>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Загрузка…</p>}
      {data && (
        <>
          {data.assumptions.parametersAreDefaults && (
            <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Параметры не заданы — расчёт показан на условных значениях
            </p>
          )}
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <Th>Товар</Th>
                  <Th right>Остаток</Th>
                  <Th right>В заказах</Th>
                  <Th right>Спрос/день</Th>
                  <Th right>Хватит, дн.</Th>
                  <Th right>Мин.</Th>
                  <Th right>Точка заказа</Th>
                  <Th right>Макс.</Th>
                  <Th right>Заказать</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.productId}>
                    <td className="px-5 py-2.5 font-medium text-foreground">{r.productName}</td>
                    <td className="px-5 py-2.5 text-right">{formatQuantity(r.onHand)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{formatQuantity(r.onOrder)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{formatQuantity(r.averageDailyDemand)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{r.daysOfCover === null ? "—" : formatQuantity(r.daysOfCover)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{formatQuantity(r.suggestedMin)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{formatQuantity(r.reorderPoint)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{formatQuantity(r.suggestedMax)}</td>
                    <td className="px-5 py-2.5 text-right font-medium">{r.suggestedOrder > 0 ? formatQuantity(r.suggestedOrder) : "—"}</td>
                    <td className="px-5 py-2.5">
                      <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

// ── plan vs fact ───────────────────────────────────────────────────────

function PlanFactView({ canManage }: { canManage: boolean }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const { data, error, setData } = useLoad<PlanFactDto>(() => api.planning.planFact(year, month), [year, month]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.rows.map((r) => [r.metric, r.plan === null ? "" : String(r.plan)])));
  }, [data]);

  async function save() {
    setSaveError(null);
    try {
      const lines = Object.values(PlanMetric).map((metric) => ({ metric, amount: draft[metric]?.trim() ? num(draft[metric]) : null }));
      setData(await api.planning.setPlan({ year, month, lines }));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Не удалось сохранить план");
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className={field} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS_RU.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <input className={clsx(field, "w-24")} inputMode="numeric" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
        {canManage && (
          <button onClick={save} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90">
            Сохранить план
          </button>
        )}
      </div>
      {(error || saveError) && <p className="mb-3 text-sm text-red-700">{error ?? saveError}</p>}
      {!data && !error && <p className="text-sm text-muted">Загрузка…</p>}
      {data && (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <Th>Показатель</Th>
                <Th right>План</Th>
                <Th right>Факт{data.factFromSnapshot ? " (снимок периода)" : ""}</Th>
                <Th right>Отклонение</Th>
                <Th right>%</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.metric}>
                  <td className="px-5 py-2.5 font-medium text-foreground">{PLAN_METRIC_LABELS_RU[r.metric]}</td>
                  <td className="px-5 py-2.5 text-right">
                    {canManage ? (
                      <input
                        className={clsx(field, "w-36 text-right")}
                        inputMode="decimal"
                        value={draft[r.metric] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [r.metric]: e.target.value })}
                      />
                    ) : r.plan === null ? (
                      "—"
                    ) : (
                      formatMoney(r.plan)
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">{formatMoney(r.fact)}</td>
                  <td className={clsx("px-5 py-2.5 text-right font-medium", r.unfavourable === null ? "text-muted" : r.unfavourable ? "text-red-700" : "text-green-700")}>
                    {r.variance === null ? "—" : formatMoney(r.variance)}
                  </td>
                  <td className="px-5 py-2.5 text-right text-muted">{r.variancePercent === null ? "—" : `${r.variancePercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ── financial model ────────────────────────────────────────────────────

const DEFAULT_DRIVERS: ModelDriversDto = {
  months: 12,
  revenueGrowthPercentPerMonth: 0,
  cogsPercentOfRevenue: null,
  fixedExpensesPerMonth: null,
  variableExpensePercentOfRevenue: null,
  capexPerMonth: 0,
  ownerWithdrawalsPerMonth: 0,
  loanRepaymentPerMonth: 0,
  openingCash: null,
};

function ModelView({ canManage }: { canManage: boolean }) {
  const [drivers, setDrivers] = useState<ModelDriversDto>(DEFAULT_DRIVERS);
  const [forecast, setForecast] = useState<ForecastDto | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioDto[]>([]);
  const [comparison, setComparison] = useState<ScenarioComparisonDto | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadScenarios = useCallback(() => {
    api.planning.scenarios().then(setScenarios).catch(() => {});
  }, []);
  useEffect(loadScenarios, [loadScenarios]);

  const run = useCallback(async () => {
    setError(null);
    try {
      setForecast(await api.planning.run(drivers));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось построить прогноз");
    }
  }, [drivers]);
  useEffect(() => {
    run();
    // run once on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setError(null);
    try {
      await api.planning.saveScenario({ name, drivers });
      setName("");
      loadScenarios();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить сценарий");
    }
  }

  const set = <K extends keyof ModelDriversDto>(key: K, value: ModelDriversDto[K]) => setDrivers({ ...drivers, [key]: value });
  const nullable = (v: string): number | null => (v.trim() === "" ? null : num(v));
  const shown = (v: number | null) => (v === null ? "" : String(v));
  const compare = useMemo(() => scenarios.map((s) => s.id), [scenarios]);

  return (
    <>
      <Card title="Допущения">
        <div className="grid gap-3 p-5 md:grid-cols-4">
          <Labeled label="Горизонт, мес.">
            <input className={clsx(field, "w-full")} inputMode="numeric" value={drivers.months} onChange={(e) => set("months", Number(e.target.value) || 0)} />
          </Labeled>
          <Labeled label="Рост выручки, % в мес.">
            <input className={clsx(field, "w-full")} inputMode="decimal" value={drivers.revenueGrowthPercentPerMonth} onChange={(e) => set("revenueGrowthPercentPerMonth", num(e.target.value) || 0)} />
          </Labeled>
          <Labeled label="Себестоимость, % (пусто — по факту)">
            <input className={clsx(field, "w-full")} inputMode="decimal" value={shown(drivers.cogsPercentOfRevenue)} onChange={(e) => set("cogsPercentOfRevenue", nullable(e.target.value))} />
          </Labeled>
          <Labeled label="Переменные расходы, % (пусто — по факту)">
            <input className={clsx(field, "w-full")} inputMode="decimal" value={shown(drivers.variableExpensePercentOfRevenue)} onChange={(e) => set("variableExpensePercentOfRevenue", nullable(e.target.value))} />
          </Labeled>
          <Labeled label="Постоянные затраты, ₸/мес. (пусто — по факту)">
            <input className={clsx(field, "w-full")} inputMode="decimal" value={shown(drivers.fixedExpensesPerMonth)} onChange={(e) => set("fixedExpensesPerMonth", nullable(e.target.value))} />
          </Labeled>
          <Labeled label="Капитальные затраты, ₸/мес.">
            <input className={clsx(field, "w-full")} inputMode="decimal" value={drivers.capexPerMonth} onChange={(e) => set("capexPerMonth", num(e.target.value) || 0)} />
          </Labeled>
          <Labeled label="Изъятия собственника, ₸/мес.">
            <input className={clsx(field, "w-full")} inputMode="decimal" value={drivers.ownerWithdrawalsPerMonth} onChange={(e) => set("ownerWithdrawalsPerMonth", num(e.target.value) || 0)} />
          </Labeled>
          <Labeled label="Погашение займов, ₸/мес.">
            <input className={clsx(field, "w-full")} inputMode="decimal" value={drivers.loanRepaymentPerMonth} onChange={(e) => set("loanRepaymentPerMonth", num(e.target.value) || 0)} />
          </Labeled>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
          <button onClick={run} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90">
            Рассчитать
          </button>
          {canManage && (
            <>
              <input className={clsx(field, "w-56")} placeholder="Название сценария" value={name} onChange={(e) => setName(e.target.value)} />
              <button onClick={save} disabled={!name.trim()} className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-50">
                Сохранить сценарий
              </button>
            </>
          )}
        </div>
      </Card>

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      {forecast && (
        <>
          <div className="mb-4 space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {forecast.notConfigured.map((n) => (
              <div key={n}>{NOT_CONFIGURED_ITEM_LABELS_RU[n as NotConfiguredItem] ?? n}</div>
            ))}
            {forecast.baseline.notes.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
          <Card title="Итоги">
            <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-5">
              <Stat label="Чистая выручка" value={formatMoney(forecast.totals.netRevenue)} />
              <Stat label="Операционная прибыль" value={formatMoney(forecast.totals.operatingProfit)} />
              <Stat label="Денежный поток" value={formatMoney(forecast.totals.netCashFlow)} />
              <Stat label="Остаток денег на конец" value={formatMoney(forecast.totals.endingCash)} />
              <Stat label="Точка безубыточности, ₸/мес." value={forecast.breakEvenMonthlyRevenue === null ? "—" : formatMoney(forecast.breakEvenMonthlyRevenue)} />
            </div>
          </Card>
          <Card title="По месяцам">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <Th>Месяц</Th>
                    <Th right>Выручка</Th>
                    <Th right>Себестоимость</Th>
                    <Th right>Расходы</Th>
                    <Th right>Амортизация</Th>
                    <Th right>Опер. прибыль</Th>
                    <Th right>Денежный поток</Th>
                    <Th right>Остаток денег</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {forecast.months.map((m) => (
                    <tr key={m.index}>
                      <td className="px-5 py-2.5 font-medium text-foreground">{MONTHS_RU[m.month - 1]} {m.year}</td>
                      <td className="px-5 py-2.5 text-right">{formatMoney(m.netRevenue)}</td>
                      <td className="px-5 py-2.5 text-right text-muted">{formatMoney(m.cogs)}</td>
                      <td className="px-5 py-2.5 text-right text-muted">{formatMoney(m.variableExpenses + m.fixedExpenses + m.inventoryLosses)}</td>
                      <td className="px-5 py-2.5 text-right text-muted">{formatMoney(m.depreciation)}</td>
                      <td className={clsx("px-5 py-2.5 text-right font-medium", m.operatingProfit < 0 && "text-red-700")}>{formatMoney(m.operatingProfit)}</td>
                      <td className="px-5 py-2.5 text-right text-muted">{formatMoney(m.netCashFlow)}</td>
                      <td className={clsx("px-5 py-2.5 text-right", m.closingCash < 0 && "text-red-700")}>{formatMoney(m.closingCash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {scenarios.length > 0 && (
        <Card title="Сценарии">
          <ul className="divide-y divide-border text-sm">
            {scenarios.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <button onClick={() => setDrivers(s.drivers)} className="font-medium text-foreground hover:underline">
                  {s.name}
                </button>
                {canManage && (
                  <button onClick={() => api.planning.deleteScenario(s.id).then(loadScenarios)} className="text-xs text-red-700 hover:underline">
                    Удалить
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-5 py-3">
            <button
              onClick={() => api.planning.compare(compare).then(setComparison).catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось сравнить"))}
              className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-muted"
            >
              Сравнить все
            </button>
          </div>
          {comparison && (
            <table className="w-full border-t border-border text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <Th>Сценарий</Th>
                  <Th right>Выручка</Th>
                  <Th right>Опер. прибыль</Th>
                  <Th right>Остаток денег</Th>
                  <Th right>Мин. остаток</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {comparison.rows.map((r) => (
                  <tr key={r.scenarioId}>
                    <td className="px-5 py-2.5 font-medium text-foreground">{r.name}</td>
                    <td className="px-5 py-2.5 text-right">{formatMoney(r.totals.netRevenue)}</td>
                    <td className="px-5 py-2.5 text-right">{formatMoney(r.totals.operatingProfit)}</td>
                    <td className="px-5 py-2.5 text-right">{formatMoney(r.totals.endingCash)}</td>
                    <td className="px-5 py-2.5 text-right text-muted">{formatMoney(r.totals.minimumCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-semibold text-foreground">{value}</div>
    </div>
  );
}
