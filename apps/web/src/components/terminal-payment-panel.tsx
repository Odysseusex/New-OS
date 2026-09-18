"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CreditCard, Loader2 } from "lucide-react";
import {
  KaspiError,
  actualize,
  ensureAccessToken,
  getTerminalUrl,
  startPayment,
  waitForResult,
  type KaspiTransaction,
} from "@/lib/kaspi-terminal";
import { formatMoney } from "@/lib/format";

// Kaspi require at least 10s between /v2/actualize calls for one payment.
const ACTUALIZE_GAP_MS = 10000;

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  // The payment is live on the terminal and the buyer is at it.
  | { kind: "waiting"; processId: string }
  | { kind: "failed"; message: string }
  // The terminal lost track of the payment: the buyer may or may not have
  // been charged. Only the terminal's own answer settles it — never a guess,
  // and never a second attempt, which could take the money twice.
  | { kind: "unknown"; processId: string; message?: string };

// Drives one card payment on the Kaspi terminal standing next to the till.
//
// The amount is sent to the terminal rather than typed on it, which is the
// whole point: a cashier retyping the total is how a buyer gets charged the
// wrong number. Everything else here exists because the money is real —
// a payment in flight cannot be abandoned silently, and an "unknown" outcome
// is surfaced loudly instead of being rounded down to a failure.
export function TerminalPaymentPanel({
  amount,
  onPaid,
  onBusyChange,
  onManual,
}: {
  amount: number;
  onPaid: (transaction: KaspiTransaction) => void;
  // Lets the parent lock its dialog shut while the terminal is live: closing
  // it would leave a payment running with nothing watching it.
  onBusyChange: (busy: boolean) => void;
  // The escape hatch when the terminal's answer never arrives. Records the
  // sale with no transaction attached, which is a person's judgement call —
  // deliberately not offered until an "unknown" has actually happened.
  onManual: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [actualizeReadyIn, setActualizeReadyIn] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase.kind === "starting" || phase.kind === "waiting";
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // A payment must not outlive the dialog: unmounting stops the polling, so
  // the terminal is not left being watched by a component that is gone.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Counts down the gap Kaspi require between actualize attempts, so the
  // button says when it will work instead of failing when pressed.
  useEffect(() => {
    if (actualizeReadyIn <= 0) return;
    const timer = setTimeout(() => setActualizeReadyIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [actualizeReadyIn]);

  const run = useCallback(async () => {
    const url = getTerminalUrl();
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase({ kind: "starting" });

    let processId = "";
    try {
      const accessToken = await ensureAccessToken(url);
      processId = await startPayment(url, accessToken, amount);
      setPhase({ kind: "waiting", processId });

      const result = await waitForResult(url, accessToken, processId, { signal: abort.signal });
      if (result.status === "success" && result.transaction) {
        onPaid(result.transaction);
        return;
      }
      if (result.status === "unknown") {
        setPhase({ kind: "unknown", processId, message: result.message });
        setActualizeReadyIn(ACTUALIZE_GAP_MS / 1000);
        return;
      }
      setPhase({ kind: "failed", message: result.message ?? "Оплата не прошла" });
    } catch (err) {
      const message = err instanceof KaspiError ? err.message : "Не удалось провести оплату";
      // Losing contact AFTER the payment started is not a failure — the
      // terminal may well be charging the card right now. Treated as unknown
      // so the cashier is told not to run it again.
      if (processId) {
        setPhase({ kind: "unknown", processId, message });
        setActualizeReadyIn(ACTUALIZE_GAP_MS / 1000);
      } else {
        setPhase({ kind: "failed", message });
      }
    }
  }, [amount, onPaid]);

  async function recheck(processId: string) {
    setActualizeReadyIn(ACTUALIZE_GAP_MS / 1000);
    try {
      const result = await actualize(getTerminalUrl(), await ensureAccessToken(getTerminalUrl()), processId);
      if (result.status === "success" && result.transaction) {
        onPaid(result.transaction);
        return;
      }
      if (result.status === "fail") {
        setPhase({ kind: "failed", message: result.message ?? "Оплата не прошла" });
        return;
      }
      setPhase({ kind: "unknown", processId, message: result.message });
    } catch (err) {
      setPhase({
        kind: "unknown",
        processId,
        message: err instanceof KaspiError ? err.message : "Терминал не ответил",
      });
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  }

  return (
    <div className="mt-3">
      {phase.kind === "idle" && (
        <button
          type="button"
          onClick={run}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-foreground transition hover:opacity-90"
        >
          <CreditCard className="h-5 w-5" strokeWidth={1.75} />
          Отправить {formatMoney(amount)} на терминал
        </button>
      )}

      {(phase.kind === "starting" || phase.kind === "waiting") && (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3.5">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" strokeWidth={1.75} />
            <p className="text-sm text-foreground">
              {phase.kind === "starting"
                ? "Отправляем сумму на терминал…"
                : "Покупатель прикладывает карту на терминале"}
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-muted"
          >
            Отменить оплату
          </button>
        </>
      )}

      {phase.kind === "failed" && (
        <>
          <div className="rounded-xl bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-900">Оплата не прошла</p>
            <p className="mt-1 text-sm text-red-800">{phase.message}</p>
          </div>
          <button
            type="button"
            onClick={run}
            className="mt-2 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            Попробовать снова
          </button>
        </>
      )}

      {phase.kind === "unknown" && (
        <>
          <div className="rounded-xl bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={2} />
              <div>
                <p className="text-sm font-medium text-amber-900">Терминал не ответил о результате</p>
                {/* Load-bearing wording, not decoration: a second attempt can
                    take the money a second time. */}
                <p className="mt-1 text-sm text-amber-800">
                  Деньги могли уже списаться. <strong>Не проводите оплату заново.</strong> Нажмите
                  «Уточнить статус» — терминал сам скажет, прошла оплата или нет.
                </p>
                {phase.message && <p className="mt-1 text-xs text-amber-700">{phase.message}</p>}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => recheck(phase.processId)}
            disabled={actualizeReadyIn > 0}
            className="mt-2 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {actualizeReadyIn > 0 ? `Уточнить статус (${actualizeReadyIn})` : "Уточнить статус"}
          </button>
          <button
            type="button"
            onClick={onManual}
            className="mt-2 w-full rounded-xl px-4 py-2.5 text-xs font-medium text-muted transition hover:bg-surface-muted"
          >
            Оплата точно прошла — провести продажу вручную
          </button>
        </>
      )}
    </div>
  );
}
