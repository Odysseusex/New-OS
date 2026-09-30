"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import {
  FINANCIAL_PERIOD_STATUS_LABELS_RU,
  FinancialPeriodStatus,
  HARD_DELETE_ROLES,
  Role,
} from "@bakery-os/shared";
import type { FinancialPeriodDto, PeriodDiagnosticsDto, PeriodPreflightDto, PeriodSnapshotDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Modal } from "@/components/modal";
import { PnlLadder } from "@/components/pnl-ladder";

const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const STATUS_STYLES: Record<FinancialPeriodStatus, string> = {
  [FinancialPeriodStatus.OPEN]: "bg-surface-muted text-muted",
  [FinancialPeriodStatus.CLOSING]: "bg-amber-50 text-amber-700",
  [FinancialPeriodStatus.CLOSED]: "bg-green-50 text-green-700",
};

// Closing a month freezes its reports; day-to-day business continues in the
// current month. Reopening is owner-only and only for the latest closed month.
export function FinancialPeriodsTab() {
  const { user } = useAuth();
  const canClose = user ? HARD_DELETE_ROLES.includes(user.role) : false;
  const isOwner = user?.role === Role.OWNER;
  const [periods, setPeriods] = useState<FinancialPeriodDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<{ period: FinancialPeriodDto; result: PeriodPreflightDto } | null>(null);
  const [snapshot, setSnapshot] = useState<PeriodSnapshotDto | null>(null);
  const [reopening, setReopening] = useState<FinancialPeriodDto | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    api.periods
      .list()
      .then((rows) => {
        setPeriods(rows);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);
  useEffect(load, [load]);

  const key = (p: FinancialPeriodDto) => `${p.year}-${p.month}`;

  async function run(p: FinancialPeriodDto, action: () => Promise<unknown>) {
    setBusy(key(p));
    setError(null);
    try {
      await action();
      setCheck(null);
      setReopening(null);
      setReason("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusy(null);
    }
  }

  async function runCheck(p: FinancialPeriodDto) {
    setBusy(key(p));
    setError(null);
    try {
      setCheck({ period: p, result: await api.periods.preflight(p.year, p.month) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить проверку");
    } finally {
      setBusy(null);
    }
  }

  async function openSnapshot(p: FinancialPeriodDto) {
    setError(null);
    try {
      setSnapshot(await api.periods.snapshot(p.year, p.month));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить снимок");
    }
  }

  if (state === "loading") return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error") return <p className="text-sm text-red-700">Не удалось загрузить периоды</p>;

  return (
    <div>
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Период</th>
              <th className="px-5 py-3 font-medium">Статус</th>
              <th className="px-5 py-3 font-medium">Версия</th>
              <th className="px-5 py-3 font-medium">Закрыт</th>
              <th className="px-5 py-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {periods.map((p) => (
              <tr key={key(p)}>
                <td className="px-5 py-3 font-medium text-foreground">
                  {MONTHS_RU[p.month - 1]} {p.year}
                </td>
                <td className="px-5 py-3">
                  <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLES[p.status])}>
                    {FINANCIAL_PERIOD_STATUS_LABELS_RU[p.status]}
                  </span>
                </td>
                <td className="px-5 py-3 text-muted">{p.status === FinancialPeriodStatus.CLOSED || p.version > 1 ? p.version : "—"}</td>
                <td className="px-5 py-3 text-muted">
                  {p.closedAt ? `${formatDateTime(p.closedAt)} · ${p.closedByName ?? ""}` : "—"}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {p.status === FinancialPeriodStatus.CLOSED && (
                      <button onClick={() => openSnapshot(p)} className="text-accent hover:underline">
                        Снимок
                      </button>
                    )}
                    {p.status === FinancialPeriodStatus.OPEN && new Date(p.to).getTime() < Date.now() && (
                      <>
                        <button disabled={busy === key(p)} onClick={() => runCheck(p)} className="text-accent hover:underline disabled:opacity-50">
                          Проверить
                        </button>
                      </>
                    )}
                    {p.canReopen && isOwner && (
                      <button onClick={() => setReopening(p)} className="text-red-700 hover:underline">
                        Открыть заново
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {check && (
        <Modal
          title={`Закрытие — ${MONTHS_RU[check.period.month - 1]} ${check.period.year}`}
          onClose={() => setCheck(null)}
          width="max-w-xl"
        >
          <div className="space-y-4">
            {check.result.blockers.map((b) => (
              <p key={b} className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {b}
              </p>
            ))}
            <DiagnosticsList d={check.result.diagnostics} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setCheck(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
                Отмена
              </button>
              {canClose && (
                <button
                  disabled={!check.result.canClose || busy === key(check.period)}
                  onClick={() => run(check.period, () => api.periods.close(check.period.year, check.period.month))}
                  className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  Закрыть период
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {reopening && (
        <Modal title={`Открыть заново — ${MONTHS_RU[reopening.month - 1]} ${reopening.year}`} onClose={() => setReopening(null)}>
          <div className="space-y-4">
            <p className="text-sm text-foreground">Снимок периода сохранится в истории. После исправлений период закрывается заново новой версией.</p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setReopening(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
                Отмена
              </button>
              <button
                disabled={reason.trim().length < 3 || busy === key(reopening)}
                onClick={() => run(reopening, () => api.periods.reopen(reopening.year, reopening.month, reason.trim()))}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Открыть период
              </button>
            </div>
          </div>
        </Modal>
      )}

      {snapshot && (
        <Modal
          title={`Снимок — ${MONTHS_RU[snapshot.month - 1]} ${snapshot.year} (версия ${snapshot.version})`}
          onClose={() => setSnapshot(null)}
          width="max-w-3xl"
        >
          <div className="space-y-4">
            <p className="text-xs text-muted">
              Создан {formatDateTime(snapshot.createdAt)} · {snapshot.createdByName}
            </p>
            <PnlLadder pnl={snapshot.payload.pnl} />
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Cell label="Остаток на начало" value={formatMoney(snapshot.payload.cashFlow.openingBalance)} />
              <Cell label="Поступления" value={formatMoney(snapshot.payload.cashFlow.totalInflow)} />
              <Cell label="Выплаты" value={formatMoney(snapshot.payload.cashFlow.totalOutflow)} />
              <Cell label="Остаток на конец" value={formatMoney(snapshot.payload.cashFlow.closingBalance)} />
            </div>
            <DiagnosticsList d={snapshot.diagnostics} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-semibold text-foreground">{value}</div>
    </div>
  );
}

// The findings recorded next to a period — separate from its figures.
function DiagnosticsList({ d }: { d: PeriodDiagnosticsDto }) {
  const rows: [string, number][] = [
    ["Расхождения остатков с журналом движений", d.stockDrifts],
    ["Расхождения денежных остатков с журналом", d.cashDrifts],
    ["Нарушения баланса событий", d.eventInvariantViolations],
    ["События без классификации", d.incompleteEvents],
    ["Денежные движения без классификации", d.unclassifiedCashMovements],
    ["Строки без себестоимости", d.unknownCostLines],
  ];
  const issues = rows.filter(([, n]) => n > 0);
  if (issues.length === 0) return <p className="text-sm text-green-700">Контрольные проверки: замечаний нет</p>;
  return (
    <div className="space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {issues.map(([label, n]) => (
        <div key={label} className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          {label}: {n}
        </div>
      ))}
    </div>
  );
}
