"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Download, FileText} from "lucide-react";
import type { CashFlowGranularity, CashFlowMonthlyDto, CashFlowOperationsDto, CashFlowMonthCellDto } from "@bakery-os/shared";
import { CASH_SECTION_LABELS_RU, CashSection } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { downloadTable, withExportTarget } from "@/lib/export-table";
import { addDaysKey, firstOfMonthKey, zonedDateKey } from "@/lib/reporting-period";
import { Modal } from "@/components/modal";

const monthInput =
  "rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const MONTH_NAMES = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."];
const monthLabel = (key: string) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const SOURCE_LABELS_RU: Record<string, string> = {
  Sale: "Продажа",
  SaleReturn: "Возврат покупателю",
  Expense: "Расход",
  Invoice: "Накладная поставщика",
  PurchaseOrder: "Заказ поставщику",
  SupplierReturn: "Возврат поставщику",
  CashMovement: "Движение по счёту",
  CashTransfer: "Перевод между счетами",
  FixedAsset: "Основное средство",
  DepreciationEntry: "Амортизация",
  Organization: "Начальный остаток",
  StockMovement: "Движение товара",
};

// Whole tenge without the currency sign: the title says «₸», and seven columns of
// "4 600 000 KZT" would not fit a screen.
const tengeFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const formatMoney = (value: number) => tengeFormat.format(Math.round(value));

const net = (c: CashFlowMonthCellDto) => Math.round((c.inflow - c.outflow) * 100) / 100;
const signed = (n: number) => (Math.abs(n) < 0.005 ? "—" : formatMoney(n));

const dm = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`;

// Defaults: six months, eight weeks or two weeks of days back to today.
function defaultRange(g: CashFlowGranularity): { from: string; to: string } {
  const today = zonedDateKey();
  if (g === "day") return { from: addDaysKey(today, -13), to: today };
  if (g === "week") {
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    return { from: addDaysKey(today, -weekday - 7 * 7), to: today };
  }
  let from = firstOfMonthKey(today);
  for (let i = 0; i < 5; i += 1) from = addDaysKey(from, -1).slice(0, 7) + "-01";
  return { from: from.slice(0, 7), to: today.slice(0, 7) };
}

const GRANULARITY_LABELS: [CashFlowGranularity, string][] = [
  ["month", "Месяцы"],
  ["week", "Недели"],
  ["day", "Дни"],
];

// A column's caption: «нояб. 2026», «26.10–01.11» or «04.11».
function columnLabel(g: CashFlowGranularity, m: { key: string; to: string }): string {
  if (g === "month") return monthLabel(m.key);
  if (g === "day") return dm(m.key);
  const last = zonedDateKey(new Date(m.to));
  return last === m.key ? dm(m.key) : `${dm(m.key)}–${dm(last)}`;
}

// The first and last calendar day (or month) a column covers, for its operations.
function columnSpan(g: CashFlowGranularity, m: { key: string; to: string }): { from: string; to: string } {
  if (g === "month") return { from: m.key, to: m.key };
  return { from: m.key, to: g === "day" ? m.key : zonedDateKey(new Date(m.to)) };
}

interface Drill {
  title: string;
  section: CashSection;
  label: string;
  granularity: CashFlowGranularity;
  from: string;
  to: string;
}

export function CashFlowMonthly() {
  const [granularity, setGranularity] = useState<CashFlowGranularity>("month");
  const initial = useMemo(() => defaultRange("month"), []);
  const [fromKey, setFromKey] = useState(initial.from);
  const [toKey, setToKey] = useState(initial.to);
  const [report, setReport] = useState<CashFlowMonthlyDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<Drill | null>(null);
  // The granularity the shown report was built for (the switch may already have moved on).
  const [shown, setShown] = useState<CashFlowGranularity>("month");

  function switchTo(g: CashFlowGranularity) {
    const r = defaultRange(g);
    setGranularity(g);
    setFromKey(r.from);
    setToKey(r.to);
  }

  useEffect(() => {
    if (!fromKey || !toKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const g = granularity;
    (g === "month" ? api.finance.cashFlowMonthly(fromKey, toKey) : api.finance.cashFlowByDate(g, fromKey, toKey))
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setShown(g);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось загрузить ДДС"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [granularity, fromKey, toKey]);

  const today = zonedDateKey();
  const isMonth = granularity === "month";
  const label = (m: { key: string; to: string }) => columnLabel(shown, m);

  function exportExcel() {
    if (!report) return;
    const heads = ["Статья", ...report.months.map(label), "Итого"];
    const rows: (string | number | { v: string | number | null; bold?: boolean })[][] = [];
    const bold = (label: string, values: number[]) => [{ v: label, bold: true }, ...values.map((v) => ({ v, bold: true }))];
    rows.push(bold("Остаток на начало", [...report.months.map((m) => m.openingBalance), report.openingBalance]));
    for (const section of report.sections) {
      if (section.lines.length === 0) continue;
      rows.push([{ v: CASH_SECTION_LABELS_RU[section.section], bold: true }]);
      for (const l of section.lines) rows.push([l.label, ...l.months.map(net), net(l.total)]);
      rows.push(bold(`Чистый поток: ${CASH_SECTION_LABELS_RU[section.section]}`, [...section.months.map((m) => m.net), section.total.net]));
    }
    rows.push(bold("Чистый денежный поток", [...report.months.map((m) => m.netFlow), report.months.reduce((s, m) => s + m.netFlow, 0)]));
    if (report.months.some((m) => m.internalNet !== 0)) {
      rows.push(["Переводы между счетами", ...report.months.map((m) => m.internalNet), report.months.reduce((s, m) => s + m.internalNet, 0)]);
    }
    rows.push(bold("Остаток на конец", [...report.months.map((m) => m.closingBalance), report.closingBalance]));
    const by = { month: "месяцам", week: "неделям", day: "дням" }[shown];
    const span = shown === "month" ? `${monthLabel(fromKey)} — ${monthLabel(toKey)}` : `${dm(fromKey)}.${fromKey.slice(0, 4)} — ${dm(toKey)}.${toKey.slice(0, 4)}`;
    void downloadTable(`dds-po-${{ month: "mesyacam", week: "nedelyam", day: "dnyam" }[shown]}-${fromKey}-${toKey}.xlsx`, heads, rows, {
      sheetName: `ДДС по ${by}`,
      titleLines: [`Движение денежных средств по ${by}`, span],
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">ДДС по периодам, ₸</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-surface-muted p-0.5">
            {GRANULARITY_LABELS.map(([g, text]) => (
              <button
                key={g}
                type="button"
                onClick={() => switchTo(g)}
                className={clsx("rounded-lg px-3 py-1 text-sm transition", granularity === g ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted hover:text-foreground")}
              >
                {text}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted" htmlFor="cf-from">
            С
          </label>
          <input
            id="cf-from"
            type={isMonth ? "month" : "date"}
            value={fromKey}
            max={toKey}
            onChange={(e) => e.target.value && setFromKey(e.target.value)}
            className={monthInput}
          />
          <label className="text-xs text-muted" htmlFor="cf-to">
            По
          </label>
          <input
            id="cf-to"
            type={isMonth ? "month" : "date"}
            value={toKey}
            min={fromKey}
            max={isMonth ? today.slice(0, 7) : today}
            onChange={(e) => e.target.value && setToKey(e.target.value)}
            className={monthInput}
          />
          <button
            type="button"
            onClick={exportExcel}
            disabled={!report}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Excel
          </button>
          <button
            type="button"
            onClick={() => withExportTarget("pdf", () => exportExcel())}
            disabled={!report}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            PDF
          </button>
        </div>
      </div>

      {error && <p className="m-5 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>}
      {loading && !report && <p className="px-5 py-8 text-center text-sm text-muted">Загрузка…</p>}

      {report && (
        <div className={clsx("overflow-x-auto", loading && "opacity-60")}>
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="sticky left-0 z-10 min-w-[210px] bg-surface px-5 py-3 font-medium">Статья</th>
                {report.months.map((m) => (
                  <th key={m.key} className="whitespace-nowrap px-3 py-3 text-right font-medium">
                    {label(m)}
                  </th>
                ))}
                <th className="whitespace-nowrap px-5 py-3 text-right font-medium">Итого</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="bg-surface-muted font-medium">
                <td className="sticky left-0 z-10 bg-surface-muted px-5 py-2.5 text-foreground">Остаток на начало</td>
                {report.months.map((m) => (
                  <td key={m.key} className="whitespace-nowrap px-3 py-2.5 text-right text-foreground">
                    {formatMoney(m.openingBalance)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-5 py-2.5 text-right text-foreground">{formatMoney(report.openingBalance)}</td>
              </tr>
              {report.months.some((m) => m.openingDeclared !== 0) && (
                <tr>
                  <td className="sticky left-0 z-10 bg-surface px-5 py-2 pl-8 text-xs text-muted">в т.ч. начальные остатки счетов, внесённые в периоде</td>
                  {report.months.map((m) => (
                    <td key={m.key} className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted">
                      {signed(m.openingDeclared)}
                    </td>
                  ))}
                  <td className="px-5 py-2" />
                </tr>
              )}

              {report.sections
                .filter((s) => s.lines.length > 0)
                .map((section) => (
                  <SectionRows key={section.section} section={section} months={report.months} granularity={shown} onDrill={setDrill} />
                ))}

              <tr className="bg-surface-muted font-semibold">
                <td className="sticky left-0 z-10 bg-surface-muted px-5 py-2.5 text-foreground">Чистый денежный поток</td>
                {report.months.map((m) => (
                  <td key={m.key} className={clsx("whitespace-nowrap px-3 py-2.5 text-right", m.netFlow < 0 ? "text-red-600" : "text-foreground")}>
                    {formatMoney(m.netFlow)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-5 py-2.5 text-right text-foreground">
                  {formatMoney(report.months.reduce((s, m) => s + m.netFlow, 0))}
                </td>
              </tr>
              {report.months.some((m) => m.internalNet !== 0) && (
                <tr>
                  <td className="sticky left-0 z-10 bg-surface px-5 py-2.5 text-muted">Переводы между счетами</td>
                  {report.months.map((m) => (
                    <td key={m.key} className="whitespace-nowrap px-3 py-2.5 text-right text-muted">
                      {signed(m.internalNet)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-5 py-2.5 text-right text-muted">{signed(report.months.reduce((s, m) => s + m.internalNet, 0))}</td>
                </tr>
              )}
              <tr className="bg-surface-muted font-semibold">
                <td className="sticky left-0 z-10 bg-surface-muted px-5 py-2.5 text-foreground">Остаток на конец</td>
                {report.months.map((m) => (
                  <td key={m.key} className="whitespace-nowrap px-3 py-2.5 text-right text-foreground">
                    {formatMoney(m.closingBalance)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-5 py-2.5 text-right text-foreground">{formatMoney(report.closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {drill && <OperationsModal drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

// A cell's figure: clickable (opens the operations behind it) when there is
// something behind it.
function DrillCell({ value, drill, onDrill }: { value: number; drill: Drill | null; onDrill: (d: Drill) => void }) {
  const text = signed(value);
  if (!drill || text === "—") return <span className="text-muted">{text}</span>;
  return (
    <button type="button" onClick={() => onDrill(drill)} className={clsx("rounded px-1 hover:bg-surface-muted hover:underline", value < 0 ? "text-red-600" : "text-foreground")}>
      {text}
    </button>
  );
}

function SectionRows({
  section,
  months,
  granularity,
  onDrill,
}: {
  section: CashFlowMonthlyDto["sections"][number];
  months: CashFlowMonthlyDto["months"];
  granularity: CashFlowGranularity;
  onDrill: (d: Drill) => void;
}) {
  const first = columnSpan(granularity, months[0]).from;
  const last = columnSpan(granularity, months[months.length - 1]).to;
  const unclassified = section.section === CashSection.UNCLASSIFIED;
  const range = `${columnLabel(granularity, months[0])} — ${columnLabel(granularity, months[months.length - 1])}`;
  return (
    <>
      <tr>
        <td colSpan={months.length + 2} className={clsx("sticky left-0 px-5 pb-1.5 pt-4 text-xs font-semibold uppercase tracking-wide", unclassified ? "text-amber-700" : "text-muted")}>
          {CASH_SECTION_LABELS_RU[section.section]}
        </td>
      </tr>
      {section.lines.map((l) => (
        <tr key={l.label} className="hover:bg-surface-muted/50">
          <td className="sticky left-0 z-10 bg-surface px-5 py-2 pl-8 text-foreground">{l.label}</td>
          {l.months.map((c, i) => (
            <td
              key={months[i].key}
              className="whitespace-nowrap px-3 py-2 text-right"
              title={c.count ? `Поступления ${formatMoney(c.inflow)} · Выплаты ${formatMoney(c.outflow)} · операций ${c.count}` : undefined}
            >
              <DrillCell
                value={net(c)}
                onDrill={onDrill}
                drill={
                  c.count
                    ? { title: `${l.label} — ${columnLabel(granularity, months[i])}`, section: section.section, label: l.label, granularity, ...columnSpan(granularity, months[i]) }
                    : null
                }
              />
            </td>
          ))}
          <td className="whitespace-nowrap px-5 py-2 text-right font-medium">
            <DrillCell
              value={net(l.total)}
              onDrill={onDrill}
              drill={{ title: `${l.label} — ${range}`, section: section.section, label: l.label, granularity, from: first, to: last }}
            />
          </td>
        </tr>
      ))}
      <tr className="font-medium">
        <td className="sticky left-0 z-10 bg-surface px-5 py-2 text-foreground">Чистый поток: {CASH_SECTION_LABELS_RU[section.section]}</td>
        {section.months.map((m, i) => (
          <td key={months[i].key} className={clsx("whitespace-nowrap px-3 py-2 text-right", m.net < 0 ? "text-red-600" : "text-foreground")}>
            {signed(m.net)}
          </td>
        ))}
        <td className={clsx("whitespace-nowrap px-5 py-2 text-right", section.total.net < 0 ? "text-red-600" : "text-foreground")}>{signed(section.total.net)}</td>
      </tr>
    </>
  );
}

function OperationsModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const [data, setData] = useState<CashFlowOperationsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (drill.granularity === "month"
      ? api.finance.cashFlowOperations({ section: drill.section, label: drill.label, fromMonth: drill.from, toMonth: drill.to })
      : api.finance.cashFlowOperationsByDate({ section: drill.section, label: drill.label, fromDate: drill.from, toDate: drill.to }))
      .then((r) => !cancelled && setData(r))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось загрузить операции"));
    return () => {
      cancelled = true;
    };
  }, [drill]);

  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <Modal title={drill.title} onClose={onClose} width="max-w-3xl">
      {error && <p className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-6 text-center text-sm text-muted">Загрузка…</p>}
      {data && (
        <>
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Операция</th>
                  <th className="px-3 py-2 font-medium">Основание</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.operations.map((o, i) => (
                  <tr key={`${o.sourceId}-${i}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{dateTime(o.occurredAt)}</td>
                    <td className="px-3 py-2 text-foreground">{o.description}</td>
                    <td className="px-3 py-2 text-muted">{SOURCE_LABELS_RU[o.sourceType] ?? o.sourceType}</td>
                    <td className={clsx("whitespace-nowrap px-3 py-2 text-right", o.amount < 0 ? "text-red-600" : "text-foreground")}>{formatMoney(o.amount)} ₸</td>
                  </tr>
                ))}
                {data.operations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted">
                      Операций нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted">
              {data.truncated ? `Показаны последние ${data.operations.length} операций` : `Операций: ${data.operations.length}`}
            </span>
            <span className="font-semibold text-foreground">Итого: {formatMoney(data.total)} ₸</span>
          </div>
        </>
      )}
    </Modal>
  );
}
