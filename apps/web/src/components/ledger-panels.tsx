"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  COVERAGE_STATUS_LABELS_RU,
  CoverageStatus,
  LEDGER_ACCOUNT_TYPE_LABELS_RU,
} from "@bakery-os/shared";
import type {
  GeneralLedgerDto,
  GlBalanceSheetDto,
  GlCashFlowDto,
  GlPnlDto,
  LedgerAccountDto,
  LedgerCoverageDto,
  LedgerDiagnosticsReportDto,
  PnlReconciliationDto,
  TrialBalanceDto,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoneyPrecise } from "@/lib/format";

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

const inputClass = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";
const th = "px-4 py-2.5 font-medium";

function Money({ value, strong }: { value: number; strong?: boolean }) {
  return <span className={clsx("tabular-nums", strong && "font-semibold", value < 0 && "text-red-700")}>{formatMoneyPrecise(value)}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function RangeBar({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
      <span>С</span>
      <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
      <span>по</span>
      <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useCallback(fetcher, deps);
  useEffect(() => {
    let live = true;
    setState("loading");
    stable()
      .then((d) => {
        if (!live) return;
        setData(d);
        setState("ready");
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить данные");
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [stable]);
  return { data, state, error };
}

function Status({ state, error }: { state: "loading" | "error" | "ready"; error: string | null }) {
  if (state === "loading") return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error") return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  return null;
}

// ── Главная книга (карточка счёта) ──────────────────────────────────────────

export function LedgerBookPanel({ accounts }: { accounts: LedgerAccountDto[] }) {
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [book, setBook] = useState<GeneralLedgerDto | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    setState("loading");
    api.ledger
      .accountLedger(accountId, startOfDay(from), endOfDay(to))
      .then((d) => {
        if (!live) return;
        setBook(d);
        setState("ready");
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить счёт");
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [accountId, from, to]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Выберите счёт</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
        <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {state === "ready" && book && (
        <Section title={`${book.account.code} — ${book.account.name}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className={th}>Дата</th>
                <th className={th}>№</th>
                <th className={th}>Документ</th>
                <th className={th}>Описание</th>
                <th className={clsx(th, "text-right")}>Дебет</th>
                <th className={clsx(th, "text-right")}>Кредит</th>
                <th className={clsx(th, "text-right")}>Остаток</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="bg-surface-muted">
                <td className="px-4 py-2" colSpan={6}>Входящее сальдо</td>
                <td className="px-4 py-2 text-right"><Money value={book.openingBalance} strong /></td>
              </tr>
              {book.rows.map((r, i) => (
                <tr key={`${r.entryId}-${i}`}>
                  <td className="px-4 py-2 text-muted">{formatDateTime(r.date)}</td>
                  <td className="px-4 py-2">{r.entryNumber}</td>
                  <td className="px-4 py-2 text-muted">{r.sourceType ?? r.reference ?? "—"}</td>
                  <td className="px-4 py-2">{r.description}</td>
                  <td className="px-4 py-2 text-right">{r.debit ? <Money value={r.debit} /> : ""}</td>
                  <td className="px-4 py-2 text-right">{r.credit ? <Money value={r.credit} /> : ""}</td>
                  <td className="px-4 py-2 text-right"><Money value={r.runningBalance} /></td>
                </tr>
              ))}
              <tr className="bg-surface-muted font-medium">
                <td className="px-4 py-2" colSpan={4}>Обороты за период / исходящее сальдо</td>
                <td className="px-4 py-2 text-right"><Money value={book.periodDebit} strong /></td>
                <td className="px-4 py-2 text-right"><Money value={book.periodCredit} strong /></td>
                <td className="px-4 py-2 text-right"><Money value={book.closingBalance} strong /></td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

// ── Оборотно-сальдовая ведомость ───────────────────────────────────────────

export function TrialBalancePanel() {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const { data, state, error } = useLoad<TrialBalanceDto>(() => api.ledger.trialBalance(startOfDay(from), endOfDay(to)), [from, to]);
  return (
    <div>
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <Status state={state} error={error} />
      {state === "ready" && data && (
        <>
          <div
            className={clsx(
              "mb-4 rounded-xl px-4 py-3 text-sm font-medium",
              data.totals.balanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700",
            )}
          >
            {data.totals.balanced
              ? "Дебет = Кредит"
              : `Не сбалансирована: расхождение ${formatMoneyPrecise(data.totals.difference)}`}
          </div>
          <Section title="Оборотно-сальдовая ведомость">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className={th}>Счёт</th>
                  <th className={th}>Тип</th>
                  <th className={clsx(th, "text-right")}>Входящее сальдо</th>
                  <th className={clsx(th, "text-right")}>Дебет</th>
                  <th className={clsx(th, "text-right")}>Кредит</th>
                  <th className={clsx(th, "text-right")}>Сальдо Дт</th>
                  <th className={clsx(th, "text-right")}>Сальдо Кт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="px-4 py-2">{r.code} — {r.name}</td>
                    <td className="px-4 py-2 text-muted">{LEDGER_ACCOUNT_TYPE_LABELS_RU[r.type]}</td>
                    <td className="px-4 py-2 text-right"><Money value={r.openingBalance} /></td>
                    <td className="px-4 py-2 text-right"><Money value={r.periodDebit} /></td>
                    <td className="px-4 py-2 text-right"><Money value={r.periodCredit} /></td>
                    <td className="px-4 py-2 text-right">{r.closingDebit ? <Money value={r.closingDebit} /> : ""}</td>
                    <td className="px-4 py-2 text-right">{r.closingCredit ? <Money value={r.closingCredit} /> : ""}</td>
                  </tr>
                ))}
                <tr className="bg-surface-muted font-semibold">
                  <td className="px-4 py-2" colSpan={3}>Итого</td>
                  <td className="px-4 py-2 text-right"><Money value={data.totals.periodDebit} strong /></td>
                  <td className="px-4 py-2 text-right"><Money value={data.totals.periodCredit} strong /></td>
                  <td className="px-4 py-2 text-right"><Money value={data.totals.closingDebit} strong /></td>
                  <td className="px-4 py-2 text-right"><Money value={data.totals.closingCredit} strong /></td>
                </tr>
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}

// ── Отчёты из главной книги ────────────────────────────────────────────────

// A deduction shown as a negative; zero stays plain zero (never "−0,00").
const neg = (n: number) => (n === 0 ? 0 : -n);

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <tr className={bold ? "bg-surface-muted" : ""}>
      <td className={clsx("px-4 py-2", bold && "font-semibold")}>{label}</td>
      <td className="px-4 py-2 text-right"><Money value={value} strong={bold} /></td>
    </tr>
  );
}

export function LedgerReportsPanel() {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const pnl = useLoad<GlPnlDto>(() => api.ledger.pnl(startOfDay(from), endOfDay(to)), [from, to]);
  const rec = useLoad<PnlReconciliationDto>(() => api.ledger.pnlReconciliation(startOfDay(from), endOfDay(to)), [from, to]);
  const bal = useLoad<GlBalanceSheetDto>(() => api.ledger.balance(endOfDay(to)), [to]);
  const flow = useLoad<GlCashFlowDto>(() => api.ledger.cashFlow(startOfDay(from), endOfDay(to)), [from, to]);

  return (
    <div>
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <Status state={pnl.state} error={pnl.error} />
          {pnl.data && (
            <Section title="Прибыли и убытки (из главной книги)">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  <Row label="Валовая выручка" value={pnl.data.grossRevenue} />
                  <Row label="Скидки" value={neg(pnl.data.discounts)} />
                  <Row label="Возвраты" value={neg(pnl.data.returns)} />
                  <Row label="Чистая выручка" value={pnl.data.netRevenue} bold />
                  <Row label="Себестоимость" value={neg(pnl.data.cogs)} />
                  <Row label="Валовая прибыль" value={pnl.data.grossProfit} bold />
                  <Row label="Потери запасов" value={neg(pnl.data.inventoryLosses)} />
                  <Row label="Операционные расходы" value={neg(pnl.data.operatingExpenses)} />
                  <Row label="Амортизация" value={neg(pnl.data.depreciation)} />
                  <Row label="Операционная прибыль" value={pnl.data.operatingProfit} bold />
                  <Row label="Прочие и финансовые статьи" value={pnl.data.otherResult} />
                  <Row label="Прибыль до налога" value={pnl.data.profitBeforeTax} bold />
                  <Row label="Налог на прибыль" value={neg(pnl.data.incomeTax)} />
                  <Row label="Чистая прибыль" value={pnl.data.netProfit} bold />
                </tbody>
              </table>
            </Section>
          )}
        </div>
        <div>
          <Status state={flow.state} error={flow.error} />
          {flow.data && (
            <Section title="Денежный поток (ДДС, из главной книги)">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  <Row label="Остаток на начало" value={flow.data.openingBalance} bold />
                  {flow.data.sections.map((s) => (
                    <Row key={s.section} label={s.label} value={s.net} />
                  ))}
                  <Row label="Внутренние переводы" value={flow.data.internalTransfers.net} />
                  <Row label="Остаток на конец" value={flow.data.closingBalance} bold />
                </tbody>
              </table>
            </Section>
          )}
        </div>
      </div>

      <Status state={bal.state} error={bal.error} />
      {bal.data && (
        <Section title="Баланс (из главной книги)">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              <Row label="Активы" value={bal.data.assets.total} bold />
              {bal.data.assets.lines.map((l) => (
                <Row key={l.accountId} label={`${l.group}: ${l.name}`} value={l.amount} />
              ))}
              <Row label="Обязательства" value={bal.data.liabilities.total} bold />
              {bal.data.liabilities.lines.map((l) => (
                <Row key={l.accountId} label={`${l.group}: ${l.name}`} value={l.amount} />
              ))}
              <Row label="Капитал" value={bal.data.equity.total} bold />
              {bal.data.equity.lines.map((l) => (
                <Row key={l.accountId} label={`${l.group}: ${l.name}`} value={l.amount} />
              ))}
              <Row label="Результат прошлых периодов" value={bal.data.equity.retainedResult} />
              <Row label="Результат текущего периода" value={bal.data.equity.currentPeriodResult} />
              <tr className={bal.data.balanced ? "bg-green-50" : "bg-red-50"}>
                <td className="px-4 py-2 font-medium">Активы − (Обязательства + Капитал)</td>
                <td className="px-4 py-2 text-right"><Money value={bal.data.difference} strong /></td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      <Status state={rec.state} error={rec.error} />
      {rec.data && (
        <Section title="Сверка с действующим отчётом ОПиУ">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className={th}>Показатель</th>
                <th className={clsx(th, "text-right")}>Главная книга</th>
                <th className={clsx(th, "text-right")}>Действующий отчёт</th>
                <th className={clsx(th, "text-right")}>Разница</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rec.data.rows.map((r) => (
                <tr key={r.metric} className={r.difference !== 0 ? "bg-amber-50" : ""}>
                  <td className="px-4 py-2">{r.metric}</td>
                  <td className="px-4 py-2 text-right"><Money value={r.ledger} /></td>
                  <td className="px-4 py-2 text-right"><Money value={r.existing} /></td>
                  <td className="px-4 py-2 text-right"><Money value={r.difference} strong={r.difference !== 0} /></td>
                </tr>
              ))}
              <tr className="bg-surface-muted">
                <td className="px-4 py-2" colSpan={4}>Операций за период не в книге: {rec.data.unpostedEvents}</td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

// ── Диагностика ────────────────────────────────────────────────────────────

const DIAG_STYLES = {
  PASS: "bg-green-50 text-green-700",
  FAIL: "bg-red-50 text-red-700",
  WARNING: "bg-amber-50 text-amber-700",
  NOT_AVAILABLE: "bg-surface-muted text-muted",
} as const;
const DIAG_LABELS = { PASS: "Норма", FAIL: "Расхождение", WARNING: "Внимание", NOT_AVAILABLE: "Нет данных" } as const;

export function LedgerDiagnosticsPanel() {
  const [report, setReport] = useState<LedgerDiagnosticsReportDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.ledger.diagnostics());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить диагностику");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void run();
  }, [run]);

  const fmt = (v: number | string | null) => (typeof v === "number" ? formatMoneyPrecise(v) : v ?? "—");

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={run} disabled={busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60">
          {busy ? "Проверка…" : "Выполнить диагностику"}
        </button>
        {report && (
          <span className="text-sm text-muted">
            Норма: {report.summary.pass} · Расхождения: {report.summary.fail} · Внимание: {report.summary.warning}
          </span>
        )}
      </div>
      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {report && !report.enabled && <p className="text-sm text-muted">Главная книга не запущена</p>}
      {report && report.enabled && (
        <Section title="Диагностика главной книги">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className={th}>Проверка</th>
                <th className={th}>Статус</th>
                <th className={clsx(th, "text-right")}>Ожидается</th>
                <th className={clsx(th, "text-right")}>Фактически</th>
                <th className={clsx(th, "text-right")}>Разница</th>
                <th className={th}>Источник</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.checks.map((c) => (
                <tr key={c.check} className="align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground">{c.title}</div>
                    {c.details?.map((d, i) => (
                      <div key={i} className="text-xs text-muted">{d}</div>
                    ))}
                  </td>
                  <td className="px-4 py-2">
                    <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", DIAG_STYLES[c.status])}>{DIAG_LABELS[c.status]}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(c.expected)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(c.actual)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.difference === null ? "—" : fmt(c.difference)}</td>
                  <td className="px-4 py-2 text-muted">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

// ── Покрытие ───────────────────────────────────────────────────────────────

const COVERAGE_STYLES: Record<CoverageStatus, string> = {
  [CoverageStatus.GL_POSTED]: "bg-green-50 text-green-700",
  [CoverageStatus.PARTIALLY_POSTED]: "bg-amber-50 text-amber-700",
  [CoverageStatus.NOT_POSTED]: "bg-red-50 text-red-700",
  [CoverageStatus.UNAPPROVED]: "bg-surface-muted text-muted",
  [CoverageStatus.NOT_APPLICABLE]: "bg-surface-muted text-muted",
};

export function LedgerCoveragePanel() {
  const { data, state, error } = useLoad<LedgerCoverageDto>(() => api.ledger.coverage(), []);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  return (
    <div>
      <Status state={state} error={error} />
      {state === "ready" && (
        <Section title="Покрытие операций проводками">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className={th}>Операции</th>
                <th className={th}>Статус</th>
                <th className={clsx(th, "text-right")}>Всего</th>
                <th className={clsx(th, "text-right")}>Проведено</th>
                <th className={clsx(th, "text-right")}>Не проведено</th>
                <th className={clsx(th, "text-right")}>До запуска</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key} className="align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground">{r.label}</div>
                    {r.note && <div className="text-xs text-muted">{r.note}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", COVERAGE_STYLES[r.status])}>{COVERAGE_STATUS_LABELS_RU[r.status]}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.total}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.posted}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.notPosted}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.notMigrated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
