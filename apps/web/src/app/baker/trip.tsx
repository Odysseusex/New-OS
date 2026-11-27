"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Bell, CheckCircle2, Clock, Truck } from "lucide-react";
import type { BakerTripStateDto } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { enablePush, pushState, syncPush, type PushState } from "./push";

// «Рейс готов»: a baker presses it when the driver is loaded. The other baker gets a notification; when
// every baker has pressed, the new notes print on the door laptop by themselves.

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
const POLL_MS = 15_000;

export interface TripHandle {
  state: BakerTripStateDto | null;
  push: PushState | null;
  busy: boolean;
  asking: boolean;
  message: string | null;
  // The trip waits for this baker: shown at the top of the screen.
  urgent: boolean;
  ask: (on: boolean) => void;
  ready: () => void;
  withdraw: () => void;
  enable: () => void;
}

export function useTrip(active: boolean, fail: (err: unknown, fallback: string) => void): TripHandle {
  const [state, setState] = useState<BakerTripStateDto | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.baker.trip().then(setState).catch(() => undefined);
  }, []);

  useEffect(() => {
    pushState().then(setPush);
    syncPush();
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const onWorker = (e: MessageEvent) => e.data?.type === "baker-refresh" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onWorker);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onWorker);
    };
  }, [active, refresh]);

  const run = async (call: () => ReturnType<typeof api.baker.tripReady>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await call();
      setState(res.state);
      if (res.launched) setMessage(`Рейс ${res.launched.number} запущен: накладных ${res.launched.noteCount}, ушли на печать`);
    } catch (err) {
      fail(err, "Не удалось — проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return {
    state,
    push,
    busy,
    asking,
    message,
    urgent: !!state?.waiting && !state.youConfirmed && state.canConfirm,
    ask: setAsking,
    ready: () => run(api.baker.tripReady),
    withdraw: () => run(api.baker.tripWithdraw),
    enable: () => {
      enablePush()
        .then((p) => {
          setPush(p);
          if (p === "blocked") setMessage("Уведомления запрещены в настройках телефона для этого приложения — разрешите их там");
        })
        .catch(() => setMessage("Не удалось включить уведомления"));
    },
  };
}

export function TripCard({ trip }: { trip: TripHandle }) {
  const { state } = trip;
  if (!state || !state.canConfirm) return null;
  const waiting = state.waiting;

  return (
    <section
      className={clsx(
        "mb-4 rounded-2xl border px-4 py-4",
        trip.urgent ? "border-amber-400 bg-amber-50" : waiting ? "border-sky-300 bg-sky-50" : "border-border bg-surface",
      )}
    >
      <div className="flex items-start gap-3">
        <Truck className={clsx("mt-0.5 h-7 w-7 shrink-0", trip.urgent ? "text-amber-700" : "text-accent")} strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          {waiting ? (
            trip.urgent ? (
              <>
                <p className="text-lg font-semibold text-amber-900">Рейс {waiting.number} ждёт вас</p>
                <p className="text-base text-amber-900">Уже нажали: {waiting.confirmed.map((c) => c.userName).join(", ")}</p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-sky-900">Рейс {waiting.number}: вы нажали</p>
                <p className="text-base text-sky-900">Ждём: {waiting.missing.map((m) => m.userName).join(", ") || "—"}</p>
              </>
            )
          ) : (
            <>
              <p className="text-lg font-semibold text-foreground">Рейс</p>
              <p className="text-base text-muted">
                {state.newNotes > 0 ? `Новых накладных для печати: ${state.newNotes}` : "Новых накладных пока нет"}
              </p>
            </>
          )}
          {state.last && (
            <p className="mt-1 text-sm text-muted">
              Рейс {state.last.number} запущен в {time(state.last.launchedAt!)} · накладных {state.last.noteCount}
            </p>
          )}
        </div>
      </div>

      {trip.message && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-base font-medium text-green-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          {trip.message}
        </p>
      )}

      {waiting && state.youConfirmed ? (
        <button type="button" disabled={trip.busy} onClick={trip.withdraw} className="mt-3 h-12 w-full rounded-2xl border border-sky-300 bg-white text-base font-medium text-sky-900 disabled:opacity-60">
          Отменить моё нажатие
        </button>
      ) : trip.asking ? (
        <div className="mt-3 space-y-2">
          <p className="text-base font-medium text-foreground">
            {waiting && waiting.missing.length <= 1 ? "Вы нажимаете последним — накладные сразу уйдут на печать." : "Машина загружена? Второму пекарю придёт уведомление."}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={trip.busy} onClick={trip.ready} className="h-14 flex-1 rounded-2xl bg-accent text-lg font-semibold text-accent-foreground disabled:opacity-60">
              {trip.busy ? "Отправляем…" : "Да, рейс готов"}
            </button>
            <button type="button" disabled={trip.busy} onClick={() => trip.ask(false)} className="h-14 rounded-2xl border border-border bg-white px-5 text-lg text-foreground">
              Нет
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!waiting && state.newNotes === 0}
          onClick={() => trip.ask(true)}
          className="mt-3 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-xl font-semibold text-accent-foreground shadow-card disabled:opacity-40"
        >
          <Truck className="h-6 w-6" strokeWidth={2} />
          Рейс готов
        </button>
      )}

      {trip.push === "off" && (
        <button type="button" onClick={trip.enable} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-white text-base font-medium text-foreground">
          <Bell className="h-5 w-5" strokeWidth={1.75} />
          Включить уведомления о рейсе
        </button>
      )}
      {trip.push === "blocked" && (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          Уведомления запрещены — разрешите их в настройках телефона для приложения «Накладные».
        </p>
      )}
      {trip.push === "needs-install" && <p className="mt-3 text-sm text-muted">Уведомления придут, когда «Накладные» добавлены на экран телефона.</p>}
    </section>
  );
}
