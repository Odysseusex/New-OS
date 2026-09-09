"use client";

import { useCallback, useEffect, useRef } from "react";

// The buyer-facing second screen of the monoblock.
//
// The two screens are two browser windows of the SAME browser on the SAME
// machine, so they talk over BroadcastChannel — no server, no socket, no
// round trip to Vercel and back. A tap on a product reaches the buyer's
// screen in the same frame, and the display keeps working if the shop's
// internet drops, which a server-relayed design would not.
//
// It also means the channel cannot cross machines: a second till in the same
// shop has its own browser and therefore its own channel, and can never show
// its cart on this one's display.
const CHANNEL = "aramir-customer-display";

export interface CustomerLine {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  // The price before markdown, set only on a marked-down line. The buyer sees
  // what the item normally costs struck through next to what they are being
  // charged — a discount nobody can see is a discount nobody trusts.
  fullUnitPrice: number | null;
}

export type CustomerState =
  | { kind: "idle"; locationName: string | null }
  | {
      kind: "cart";
      locationName: string | null;
      lines: CustomerLine[];
      total: number;
    }
  | {
      kind: "paid";
      locationName: string | null;
      total: number;
      // Only for a cash sale. Null means the question does not apply, which
      // is different from "no change due" — the display shows nothing rather
      // than a misleading 0.
      change: number | null;
      receiptNumber: string | null;
      qrCode: string | null;
    };

type Message =
  | { type: "state"; state: CustomerState }
  // Sent by the display when it opens. The channel carries no history, so a
  // display opened mid-order would otherwise sit blank until the next tap —
  // which is exactly when the cashier is least able to investigate.
  | { type: "hello" };

function open(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

// Till side. Returns nothing — it publishes whatever `state` currently is, and
// answers a display that asks for it.
export function useCustomerDisplayPublisher(state: CustomerState) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  // The publisher answers "hello" with whatever is on screen *now*, which is
  // not what it captured when the listener was attached. A ref keeps the
  // handler reading the current value without re-subscribing on every keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const channel = open();
    channelRef.current = channel;
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.type === "hello") {
        channel.postMessage({ type: "state", state: stateRef.current } satisfies Message);
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    channelRef.current?.postMessage({ type: "state", state } satisfies Message);
  }, [state]);
}

// Display side.
export function useCustomerDisplaySubscriber(onState: (state: CustomerState) => void) {
  const handlerRef = useRef(onState);
  handlerRef.current = onState;

  useEffect(() => {
    const channel = open();
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.type === "state") handlerRef.current(event.data.state);
    };
    channel.postMessage({ type: "hello" } satisfies Message);
    return () => channel.close();
  }, []);
}

export type OpenResult = "placed" | "opened" | "blocked" | "single-screen";

// Opens the display window. Placing it on the second screen needs the Window
// Management API, which asks the user for permission the first time; without
// it (permission refused, or an older browser) the window still opens and can
// be dragged across by hand once.
export async function openCustomerDisplay(): Promise<OpenResult> {
  const url = "/customer";
  try {
    if ("getScreenDetails" in window) {
      const details = await (
        window as Window & { getScreenDetails: () => Promise<{ screens: ScreenPlacement[] }> }
      ).getScreenDetails();
      const other = details.screens.find((s) => !s.isPrimary);
      if (!other) return window.open(url, "aramir-customer") ? "single-screen" : "blocked";
      const features = `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
      return window.open(url, "aramir-customer", features) ? "placed" : "blocked";
    }
  } catch {
    // Permission refused or the API is missing — fall through to a plain
    // window rather than leaving the cashier with nothing.
  }
  return window.open(url, "aramir-customer") ? "opened" : "blocked";
}

interface ScreenPlacement {
  isPrimary: boolean;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

// Fullscreen has to be asked for by the window that wants it, from a real
// user gesture — the till window cannot put the display window fullscreen on
// its behalf. Hence the corner button on the display itself.
export function useFullscreenToggle() {
  return useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused by the browser; F11 still works.
    }
  }, []);
}
