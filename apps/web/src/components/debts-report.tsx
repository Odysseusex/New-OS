"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Download, FileText } from "lucide-react";
import type { CashAccountDto, DebtCounterpartyRowDto, DebtItemDto, DebtReportDto } from "@bakery-os/shared";
import { DEBT_AGE_BUCKET_LABELS_RU, DEBT_AGE_BUCKETS, DebtCounterpartyKind, DebtDocumentKind } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { downloadTable, withExportTarget } from "@/lib/export-table";
import { formatMoney } from "@/lib/format";
import { zonedDateKey } from "@/lib/reporting-period";
import { RecordDebtPaymentModal } from "@/components/record-debt-payment-modal";
import { CounterpartyStatementModal } from "@/components/counterparty-statement-modal";

export type DebtSide = "receivables" | "payables";

const keyLabel = (key: string) => key.split("-").reverse().join(".");
const cell = (n: number) => (n > 0.004 ? formatMoney(n) : "—");

// Documents that can be paid off from here; goods «под реализацию» are paid
// out in their own section.
const PAYABLE_KINDS = new Set<DebtDocumentKind>([
  DebtDocumentKind.SALE,
  DebtDocumentKind.PURCHASE_ORDER,
  DebtDocumentKind.INVOICE,
  DebtDocumentKind.EXPENSE,
]);

async function pay(item: DebtItemDto, amount: number, accountId: string) {
  const id = item.documentId as string;
  switch (item.kind) {
    case DebtDocumentKind.SALE:
      return api.sales.recordPayment(id, { amount, accountId });
    case DebtDocumentKind.PURCHASE_ORDER:
      return api.procurement.payOrder(id, { amount, accountId });
    case DebtDocumentKind.INVOICE:
      return api.invoices.recordPayment(id, { amount, accountId });
    case DebtDocumentKind.EXPENSE:
      return api.finance.recordExpensePayment(id, { amount, accountId });
  }
}

export function DebtsReport({
  side,
  accounts,
  canPay,
  onPaid,
  reloadToken = 0,
}: {
  side: DebtSide;
  accounts: CashAccountDto[];
  canPay: boolean;
  onPaid?: () => void;
  reloadToken?: number;
}) {
  const today = zonedDateKey();
  const [asOf, setAsOf] = useState(today);
  const [report, setReport] = useState<DebtReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [statementFor, setStatementFor] = useState<DebtCounterpartyRowDto | null>(null);
  const [paying, setPaying] = useState<DebtItemDto | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (side === "receivables" ? api.debts.receivables(asOf) : api.debts.payables(asOf))
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось загрузить задолженность"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // reloadToken only asks for a fresh load of the same report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, asOf, reloadToken]);

  useEffect(() => load(), [load]);

  const rowKey = (r: DebtCounterpartyRowDto) => `${r.kind}:${r.counterpartyId ?? "none"}`;
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const isToday = asOf === today;
  const title = side === "receivables" ? "Дебиторская задолженность" : "Кредиторская задолженность";

  function exportCsv() {
    if (!report) return;
    downloadTable(
      `${side === "receivables" ? "debitorka" : "kreditorka"}-${report.asOfKey}.csv`,
      ["Контрагент", "БИН/ИИН", "Задолженность", "Просрочено", "Дней просрочки", ...DEBT_AGE_BUCKETS.map((b) => DEBT_AGE_BUCKET_LABELS_RU[b])],
      report.counterparties.map((r) => [r.name, r.bin ?? "", r.outstanding, r.overdue, r.maxOverdueDays || "", ...DEBT_AGE_BUCKETS.map((b) => r.byAge[b])]),
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted" htmlFor={`${side}-asof`}>
            На дату
          </label>
          <input
            id={`${side}-asof`}
            type="date"
            value={asOf}
            max={today}
            onChange={(e) => setAsOf(e.target.value || today)}
            className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={!report}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Excel
          </button>
          <button
            type="button"
            onClick={() => withExportTarget("pdf", () => exportCsv())}
            disabled={!report}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            PDF
          </button>
        </div>
      </div>

      {report && (
        <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Итого", value: report.total, tone: "text-foreground" },
            { label: "Просрочено", value: report.overdue, tone: report.overdue > 0 ? "text-red-600" : "text-foreground" },
            ...DEBT_AGE_BUCKETS.map((b) => ({ label: DEBT_AGE_BUCKET_LABELS_RU[b], value: report.byAge[b], tone: "text-foreground" })),
          ].map((s) => (
            <div key={s.label} className="bg-surface px-5 py-3">
              <p className="text-xs text-muted">{s.label}</p>
              <p className={clsx("mt-0.5 text-sm font-semibold", s.tone)}>{formatMoney(s.value)}</p>
            </div>
          ))}
        </div>
      )}

      {error && <p className="m-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loading && !report && <p className="px-5 py-8 text-center text-sm text-muted">Загрузка…</p>}

      {report && (
        <div className={clsx("overflow-x-auto", loading && "opacity-60")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Контрагент</th>
                <th className="px-3 py-3 text-right font-medium">Задолженность</th>
                <th className="px-3 py-3 text-right font-medium">Просрочено</th>
                <th className="px-3 py-3 text-right font-medium">Дней просрочки</th>
                {DEBT_AGE_BUCKETS.map((b) => (
                  <th key={b} className="whitespace-nowrap px-3 py-3 text-right font-medium">
                    {DEBT_AGE_BUCKET_LABELS_RU[b]}
                  </th>
                ))}
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.counterparties.map((r) => {
                const key = rowKey(r);
                const expanded = open.has(key);
                return (
                  <Fragment key={key}>
                    <tr className="cursor-pointer hover:bg-surface-muted" onClick={() => toggle(key)}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          {expanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
                          )}
                          <div>
                            <p className="text-foreground">{r.name}</p>
                            {(r.bin || r.paymentTermDays !== null) && (
                              <p className="text-xs text-muted">
                                {[r.bin ? `БИН/ИИН ${r.bin}` : null, r.paymentTermDays !== null ? `отсрочка ${r.paymentTermDays} дн.` : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-foreground">{formatMoney(r.outstanding)}</td>
                      <td className={clsx("whitespace-nowrap px-3 py-3 text-right", r.overdue > 0 ? "font-medium text-red-600" : "text-muted")}>
                        {cell(r.overdue)}
                      </td>
                      <td className={clsx("px-3 py-3 text-right", r.maxOverdueDays > 0 ? "text-red-600" : "text-muted")}>
                        {r.maxOverdueDays > 0 ? r.maxOverdueDays : "—"}
                      </td>
                      {DEBT_AGE_BUCKETS.map((b) => (
                        <td key={b} className="whitespace-nowrap px-3 py-3 text-right text-muted">
                          {cell(r.byAge[b])}
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right">
                        {r.kind !== DebtCounterpartyKind.NONE && r.counterpartyId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStatementFor(r);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-surface"
                          >
                            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                            Карточка
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-surface-muted/50">
                        <td colSpan={9} className="px-5 pb-4 pt-1">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-muted">
                                <th className="py-2 pl-6 font-medium">Документ</th>
                                <th className="px-3 py-2 font-medium">Дата</th>
                                <th className="px-3 py-2 font-medium">Срок оплаты</th>
                                <th className="px-3 py-2 text-right font-medium">Сумма</th>
                                <th className="px-3 py-2 text-right font-medium">Остаток</th>
                                <th className="px-3 py-2 text-right font-medium">Просрочка, дн.</th>
                                <th className="py-2" />
                              </tr>
                            </thead>
                            <tbody>
                              {r.items.map((i, n) => (
                                <tr key={`${i.documentId ?? i.dateKey}-${n}`} className="border-t border-border/60">
                                  <td className="py-2 pl-6 text-foreground">{i.label}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-muted">{keyLabel(i.dateKey)}</td>
                                  <td className={clsx("whitespace-nowrap px-3 py-2", i.overdueDays > 0 ? "text-red-600" : "text-muted")}>
                                    {keyLabel(i.dueDateKey)}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{formatMoney(i.amount)}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-foreground">{formatMoney(i.outstanding)}</td>
                                  <td className={clsx("px-3 py-2 text-right", i.overdueDays > 0 ? "font-medium text-red-600" : "text-muted")}>
                                    {i.overdueDays > 0 ? i.overdueDays : "—"}
                                  </td>
                                  <td className="py-2 text-right">
                                    {canPay && isToday && i.documentId && PAYABLE_KINDS.has(i.kind) && (
                                      <button
                                        type="button"
                                        onClick={() => setPaying(i)}
                                        className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition hover:opacity-90"
                                      >
                                        {side === "receivables" ? "Принять оплату" : "Погасить"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {report.counterparties.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-sm text-muted">
                    {side === "receivables" ? "Дебиторской задолженности нет" : "Кредиторской задолженности нет"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {report && (report.advances ?? []).length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-border bg-surface">
          <div className="flex items-baseline justify-between px-5 pt-4">
            <span className="text-sm font-semibold text-foreground">
              {side === "receivables" ? "Авансы выданные (поставщикам)" : "Авансы полученные (от покупателей)"}
            </span>
            <span className="text-sm font-semibold text-foreground">{formatMoney(report.advancesTotal)}</span>
          </div>
          <table className="mt-2 w-full text-sm">
            <tbody className="divide-y divide-border">
              {report.advances.map((a) => (
                <tr key={a.counterpartyId}>
                  <td className="px-5 py-2.5 text-foreground">
                    <button
                      onClick={() => setStatementFor({ kind: a.kind, counterpartyId: a.counterpartyId, name: a.name } as never)}
                      className="text-left hover:underline"
                    >
                      {a.name}
                    </button>
                  </td>
                  <td className="px-5 py-2.5 text-right text-foreground">{formatMoney(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {statementFor && statementFor.counterpartyId && (
        <CounterpartyStatementModal
          kind={statementFor.kind}
          counterpartyId={statementFor.counterpartyId}
          name={statementFor.name}
          onClose={() => setStatementFor(null)}
        />
      )}

      {paying && (
        <RecordDebtPaymentModal
          title={`${side === "receivables" ? "Оплата" : "Погашение"}: ${paying.label}`}
          balanceDue={paying.outstanding}
          accounts={accounts}
          onClose={() => setPaying(null)}
          onSubmit={async (amount, accountId) => {
            await pay(paying, amount, accountId);
            setPaying(null);
            load();
            onPaid?.();
          }}
        />
      )}
    </div>
  );
}
