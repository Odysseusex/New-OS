"use client";

import { useEffect, useState } from "react";
import { Check, Maximize2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  useCustomerDisplaySubscriber,
  useFullscreenToggle,
  type CustomerState,
} from "@/lib/customer-display";
import { formatMoney, formatQuantity } from "@/lib/format";

// The buyer's screen on the two-screen monoblock.
//
// Deliberately NOT under (app): that layout draws the sidebar and topbar and
// bounces a CASHIER to /pos, so the till's own login would kick this page out
// the moment it opened.
//
// It is also completely passive — it makes no API call and needs no login. It
// renders only what the till window broadcasts to it, which is why it is safe
// for it to be reachable without a password: opened by itself it shows a
// welcome and nothing else.
export default function CustomerDisplayPage() {
  const [state, setState] = useState<CustomerState>({ kind: "idle", locationName: null });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useFullscreenToggle();

  useCustomerDisplaySubscriber(setState);

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {!isFullscreen && (
        <button
          onClick={toggleFullscreen}
          title="Во весь экран"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg text-muted/60 transition hover:bg-surface-muted hover:text-foreground"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}

      {state.kind === "idle" && <IdleScreen locationName={state.locationName} />}
      {state.kind === "cart" && <CartScreen state={state} />}
      {state.kind === "paid" && <PaidScreen state={state} />}
    </div>
  );
}

function IdleScreen({ locationName }: { locationName: string | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p className="text-6xl font-semibold tracking-tight text-foreground">Ar-Amir</p>
      {locationName && <p className="text-2xl text-muted">{locationName}</p>}
      <p className="mt-6 text-3xl text-muted">Добро пожаловать</p>
    </div>
  );
}

function CartScreen({ state }: { state: Extract<CustomerState, { kind: "cart" }> }) {
  return (
    <>
      <div className="flex shrink-0 items-baseline gap-3 px-10 pt-6">
        <span className="text-2xl font-semibold tracking-tight">Ar-Amir</span>
        {state.locationName && <span className="text-xl text-muted">{state.locationName}</span>}
      </div>

      {/* The list grows from the bottom, so the item just added is always the
          one in view — on a long order the buyer would otherwise be watching
          the top of a list while the cashier scans onto the end. */}
      <div className="flex flex-1 flex-col justify-end overflow-hidden px-10 pt-4">
        <div className="flex flex-col gap-2 overflow-y-auto">
          {state.lines.map((line) => (
            <div key={line.key} className="flex items-baseline gap-5 border-b border-border/60 pb-2">
              <span className="min-w-0 flex-1 truncate text-3xl font-medium">{line.name}</span>
              <span className="shrink-0 text-2xl text-muted">
                {formatQuantity(line.quantity)} {line.unit} ×{" "}
                {line.fullUnitPrice != null && (
                  <span className="text-muted/60 line-through">{formatMoney(line.fullUnitPrice)}</span>
                )}{" "}
                <span className={line.fullUnitPrice != null ? "font-semibold text-accent" : ""}>
                  {formatMoney(line.unitPrice)}
                </span>
              </span>
              {/* Spelled out as well as struck through. The buyer is reading
                  this from a metre away, across the counter — the discount has
                  to be unmistakable, not inferred from a thin line. The percent
                  is computed from the two prices rather than assumed, so it
                  stays true if the markdown rate is ever changed. */}
              {line.fullUnitPrice != null && (
                <span className="shrink-0 rounded-lg bg-accent/10 px-2.5 py-1 text-xl font-semibold text-accent">
                  Уценка −{Math.round((1 - line.unitPrice / line.fullUnitPrice) * 100)}%
                </span>
              )}
              <span className="w-44 shrink-0 text-right text-3xl font-semibold tabular-nums">
                {formatMoney(line.unitPrice * line.quantity)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-baseline justify-between border-t-2 border-border px-10 py-8">
        <span className="text-4xl text-muted">Итого</span>
        <span className="text-7xl font-bold tabular-nums text-accent">{formatMoney(state.total)}</span>
      </div>
    </>
  );
}

function PaidScreen({ state }: { state: Extract<CustomerState, { kind: "paid" }> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-accent/10">
        <Check className="h-14 w-14 text-accent" strokeWidth={2.5} />
      </div>
      <p className="text-5xl font-semibold">Спасибо за покупку!</p>
      <p className="text-6xl font-bold tabular-nums text-accent">{formatMoney(state.total)}</p>
      {state.change != null && state.change > 0 && (
        <p className="text-4xl text-muted">
          Сдача <span className="font-semibold text-foreground">{formatMoney(state.change)}</span>
        </p>
      )}
      {/* The fiscal receipt belongs to the buyer, and this screen is the one
          facing them — so the QR they are meant to scan goes here rather than
          only on the cashier's side. Black on white on purpose: it has to
          survive a phone camera, the one documented exception to the app's
          no-hardcoded-colours rule. */}
      {state.qrCode && (
        <div className="rounded-xl bg-white p-4">
          <QRCodeSVG value={state.qrCode} size={168} bgColor="#ffffff" fgColor="#000000" />
        </div>
      )}
      {state.receiptNumber && (
        <p className="text-xl text-muted">Чек № {state.receiptNumber}</p>
      )}
    </div>
  );
}
