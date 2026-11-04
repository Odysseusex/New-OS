"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Printer, Wallet } from "lucide-react";
import type { TillShiftDetailDto, TillShiftDto, TillShiftReportDto, TillShiftStateDto } from "@bakery-os/shared";
import { PAYMENT_METHOD_LABELS_RU, PaymentMethod } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney } from "@/lib/format";
import { printSheets } from "@/lib/print-table";

const input =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const time = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const parse = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

type Mode = "view" | "IN" | "OUT" | "close";

// «Смена» on the till: open with the cash counted, внесение / выемка, X-отчёт,
// close with the Z-отчёт. When the organization requires a shift and none is
// open, it says so in the header (the server refuses a cashier's sale anyway).
export function TillShiftControl({
  locationId,
  reloadKey,
  onState,
}: {
  locationId: string;
  reloadKey?: unknown;
  onState?: (state: TillShiftStateDto) => void;
}) {
  const [state, setState] = useState<TillShiftStateDto | null>(null);
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState<TillShiftDetailDto | null>(null);

  const load = useCallback(() => {
    if (!locationId) return;
    api.tillShifts
      .current(locationId)
      .then((st) => {
        setState(st);
        onState?.(st);
      })
      .catch(() => setState(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(load, [load, reloadKey]);

  if (!state) return null;
  const shift = state.shift;
  const blocked = state.required && !shift;

  return (
    <>
      <button
        onClick={() => {
          setClosed(null);
          setOpen(true);
          load();
        }}
        className={clsx(
          "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
          blocked ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100" : "border-border bg-surface text-foreground hover:bg-surface-muted",
        )}
      >
        <Wallet className="h-4 w-4" strokeWidth={1.75} />
        {shift ? `Смена №${shift.number}` : "Открыть смену"}
        <span className={clsx("h-2 w-2 rounded-full", shift ? "bg-emerald-500" : "bg-red-400")} aria-hidden />
      </button>
      {open && (
        <ShiftModal
          locationId={locationId}
          state={state}
          closed={closed}
          onClose={() => setOpen(false)}
          onChanged={(next) => {
            if (next) setClosed(next);
            load();
          }}
        />
      )}
    </>
  );
}

function ShiftModal({
  locationId,
  state,
  closed,
  onClose,
  onChanged,
}: {
  locationId: string;
  state: TillShiftStateDto;
  closed: TillShiftDetailDto | null;
  onClose: () => void;
  onChanged: (closed?: TillShiftDetailDto) => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId && state.otherAccounts.length > 0) setAccountId(state.otherAccounts[0].id);
  }, [state.otherAccounts, accountId]);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить");
    } finally {
      setBusy(false);
    }
  }

  const shift = state.shift;
  const report = state.report;

  if (closed) {
    return (
      <Modal title={`Z-отчёт · смена №${closed.number}`} onClose={onClose} width="max-w-xl">
        <ReportView shift={closed} report={closed.report} />
        <ResultLine label="Посчитано в кассе" value={closed.countedCash ?? 0} />
        {closed.difference !== null && (
          <ResultLine label="Расхождение" value={closed.difference} tone={closed.difference ? (closed.difference < 0 ? "text-red-700" : "text-emerald-700") : undefined} />
        )}
        <button onClick={() => printReport("Z-отчёт", closed, closed.report)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted">
          <Printer className="h-4 w-4" strokeWidth={1.75} />
          Печать Z-отчёта
        </button>
      </Modal>
    );
  }

  if (!shift) {
    return (
      <Modal title={`Открыть смену №${state.nextNumber}`} onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = parse(amount);
            if (!Number.isFinite(value) || value < 0) {
              setError("Введите сумму наличных в кассе");
              return;
            }
            void run(async () => {
              await api.tillShifts.open({ locationId, openingCash: value });
              setAmount("");
              onChanged();
            });
          }}
        >
          {!state.tillAccount && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">У точки нет кассы наличных — создайте счёт «Касса» с этой точкой в Финансах</p>}
          <label className="mb-1.5 block text-sm font-medium text-foreground">Наличные в кассе, ₸</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
          {state.tillAccount && state.tillAccount.balance !== null && (
            <p className="mt-1.5 text-xs text-muted">По учёту в кассе: {formatMoney(state.tillAccount.balance)}</p>
          )}
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button type="submit" data-submit disabled={busy || !state.tillAccount} className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50">
            {busy ? "Открываем…" : "Открыть смену"}
          </button>
        </form>
      </Modal>
    );
  }

  // Null for the till's own staff: a blind count, nothing to compare against on screen.
  const expected = report?.expectedCash ?? null;
  const counted = parse(amount);

  return (
    <Modal title={`Смена №${shift.number} · ${shift.locationName}`} onClose={onClose} width="max-w-xl">
      {report && mode === "view" && (
        <>
          <ReportView shift={shift} report={report} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <ActionButton onClick={() => { setMode("IN"); setAmount(""); setComment(""); }}>Внесение</ActionButton>
            <ActionButton onClick={() => { setMode("OUT"); setAmount(""); setComment(""); }}>Выемка</ActionButton>
            <ActionButton onClick={() => printReport("X-отчёт", shift, report)}>
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              X-отчёт
            </ActionButton>
            <button onClick={() => { setMode("close"); setAmount(""); setComment(""); }} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90">
              Закрыть смену
            </button>
          </div>
        </>
      )}

      {(mode === "IN" || mode === "OUT") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.tillShifts.moveCash(shift.id, { direction: mode, amount: parse(amount), accountId, comment: comment.trim() });
              setMode("view");
              onChanged();
            });
          }}
        >
          <p className="mb-3 text-sm font-semibold text-foreground">{mode === "IN" ? "Внесение наличных в кассу" : "Выемка наличных из кассы"}</p>
          <label className="mb-1.5 block text-sm text-foreground">Сумма, ₸</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
          <label className="mb-1.5 mt-3 block text-sm text-foreground">{mode === "IN" ? "Откуда" : "Куда"}</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={input}>
            {state.otherAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label className="mb-1.5 mt-3 block text-sm text-foreground">Комментарий</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={mode === "IN" ? "Размен" : "Инкассация"} className={input} />
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setMode("view")} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
              Назад
            </button>
            <button type="submit" data-submit disabled={busy || !(parse(amount) > 0) || comment.trim().length < 3 || !accountId} className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
              {mode === "IN" ? "Внести" : "Изъять"}
            </button>
          </div>
        </form>
      )}

      {mode === "close" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const z = await api.tillShifts.close(shift.id, { countedCash: counted, note: comment.trim() || undefined });
              onChanged(z);
            });
          }}
        >
          {expected !== null && <ResultLine label="Должно быть в кассе" value={expected} />}
          <label className="mb-1.5 mt-3 block text-sm font-medium text-foreground">Посчитано наличных, ₸</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
          {expected !== null && amount.trim() !== "" && Number.isFinite(counted) && (
            <ResultLine
              label="Расхождение"
              value={Math.round((counted - expected) * 100) / 100}
              tone={counted < expected ? "text-red-700" : counted > expected ? "text-emerald-700" : undefined}
            />
          )}
          <label className="mb-1.5 mt-3 block text-sm text-foreground">Комментарий</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} className={input} />
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setMode("view")} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
              Назад
            </button>
            <button type="submit" data-submit disabled={busy || amount.trim() === "" || !Number.isFinite(counted) || counted < 0} className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
              {busy ? "Закрываем…" : "Закрыть смену"}
            </button>
          </div>
        </form>
      )}
      {mode === "view" && error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted">
      {children}
    </button>
  );
}

function ResultLine({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="mt-2 flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className={clsx("font-semibold", tone ?? "text-foreground")}>{formatMoney(value)}</span>
    </div>
  );
}

function reportRows(report: TillShiftReportDto): [string, number | string, boolean?][] {
  const rows: [string, number | string, boolean?][] = [
    ["Чеков", report.checks],
    ["Возвратов", report.returns],
  ];
  if (report.revenue !== null) rows.push(["Выручка", report.revenue, true]);
  for (const t of report.tenders) {
    rows.push([PAYMENT_METHOD_LABELS_RU[t.method as PaymentMethod] ?? t.method, t.sales]);
    if (t.kaspiQr) rows.push(["  в т.ч. Kaspi QR", t.kaspiQr.sales]);
    if (t.refunds) rows.push([`  возвраты: ${(PAYMENT_METHOD_LABELS_RU[t.method as PaymentMethod] ?? t.method).toLowerCase()}`, -t.refunds]);
  }
  if (report.onCredit) rows.push(["В долг", report.onCredit]);
  rows.push(["Наличные на начало смены", report.openingCash, true]);
  if (report.cashSales !== null) rows.push(["+ продажи наличными", report.cashSales]);
  if (report.cashRefunds) rows.push(["− возвраты наличными", -report.cashRefunds]);
  for (const m of report.cashMoves) rows.push([`${m.amount > 0 ? "Внесение" : "Выемка"} ${time(m.at)}${m.comment ? ` · ${m.comment}` : ""}${m.counterpart ? ` (${m.counterpart})` : ""}`, m.amount]);
  if (report.expectedCash !== null) rows.push(["Должно быть в кассе", report.expectedCash, true]);
  return rows;
}

function ReportView({ shift, report }: { shift: TillShiftDto; report: TillShiftReportDto }) {
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        Открыта {time(shift.openedAt)} · {shift.openedByName}
        {shift.closedAt ? ` · закрыта ${time(shift.closedAt)} · ${shift.closedByName ?? ""}` : ""}
      </p>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {reportRows(report).map(([label, value, bold], i) => (
              <tr key={`${label}-${i}`} className={clsx(bold && "bg-surface-muted font-semibold")}>
                <td className="px-3 py-2 text-foreground">{label}</td>
                <td className="px-3 py-2 text-right text-foreground">{typeof value === "number" && !/^Чеков|^Возвратов/.test(label) ? formatMoney(value) : value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function printReport(title: string, shift: TillShiftDto, report: TillShiftReportDto) {
  const rows = reportRows(report).map(([label, value, bold]) => [{ v: label, bold }, typeof value === "number" && !/^Чеков|^Возвратов/.test(label) ? { v: value, fmt: "money" as const, bold } : value]);
  if (shift.countedCash !== null) {
    rows.push([{ v: "Посчитано в кассе", bold: true }, { v: shift.countedCash, fmt: "money" as const, bold: true }]);
    if (shift.difference !== null) rows.push([{ v: "Расхождение", bold: true }, { v: shift.difference, fmt: "money" as const, bold: true }]);
  }
  printSheets([
    {
      name: title,
      titleLines: [`${title} · смена №${shift.number} · ${shift.locationName}`, `Открыта ${time(shift.openedAt)} (${shift.openedByName})${shift.closedAt ? ` · закрыта ${time(shift.closedAt)} (${shift.closedByName ?? ""})` : ""}`],
      headers: ["", "₸"],
      rows,
    },
  ]);
}
