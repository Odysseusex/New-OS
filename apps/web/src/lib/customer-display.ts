"use client";

import { useEffect, useRef } from "react";

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

export interface ScreenPlacement {
  isPrimary: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  // System-provided monitor name where the browser has one (a real model
  // string, or "Built-in Display") — present often enough to be worth using
  // as the stable half of the identity below, absent often enough that a
  // fallback is still required.
  label?: string;
}

export type OpenOutcome =
  | { kind: "placed" }
  | { kind: "opened" }
  | { kind: "blocked" }
  | { kind: "single-screen" }
  // More than one screen exists and none of them is the one remembered from
  // last time — either this is the first run on this machine, or the
  // machine's displays changed since. Handing the list back rather than
  // guessing is the whole fix: guessing via isPrimary is what put the
  // customer window on the wrong physical monitor the moment Windows
  // decided the other one was primary.
  | { kind: "needs-pick"; screens: ScreenPlacement[]; hostIndex: number | null };

// Which physical monitor is remembered as "the customer's", on THIS machine.
// Deliberately NOT keyed on isPrimary — that is a Windows setting the owner
// did not ask this app to depend on, and Windows changing it (a monitor
// reconnect, a driver update, a stray click in its own display settings)
// used to silently swap which screen the customer window landed on. Once a
// screen is picked here, it stays picked until the cashier explicitly picks
// a different one via «Сменить экран», regardless of what Windows calls
// primary from then on.
const SCREEN_KEY = "aramir.customerDisplayScreen";

// The monitor's label if the browser reports one — stable across a Windows
// primary flip because it names the physical panel, not its role. Falls back
// to its resolution, which is also a property of the panel rather than of
// Windows' current arrangement; left/top are deliberately excluded from this
// because those DO move when Windows renumbers which screen sits at (0,0).
function screenSignature(screen: ScreenPlacement): string {
  return screen.label ? `label:${screen.label}` : `size:${screen.width}x${screen.height}`;
}

function rememberScreen(screen: ScreenPlacement): void {
  try {
    localStorage.setItem(SCREEN_KEY, screenSignature(screen));
  } catch {
    // Storage blocked — the window still opens, it just will not be
    // remembered for next time.
  }
}

function rememberedSignature(): string | null {
  try {
    return localStorage.getItem(SCREEN_KEY);
  } catch {
    return null;
  }
}

// For the «Сменить экран» control: forget the remembered monitor so the next
// open shows the picker again, for when a cable was swapped or the wrong
// screen was picked the first time.
export function forgetRememberedCustomerScreen(): void {
  try {
    localStorage.removeItem(SCREEN_KEY);
  } catch {
    // Nothing to do — there was likely nothing stored anyway.
  }
}

async function detectedScreens(): Promise<ScreenPlacement[] | null> {
  try {
    if (!("getScreenDetails" in window)) return null;
    const details = await (
      window as Window & { getScreenDetails: () => Promise<{ screens: ScreenPlacement[] }> }
    ).getScreenDetails();
    return details.screens;
  } catch {
    // Permission refused or the API errored.
    return null;
  }
}

// Which entry in `screens` the CALLING window (the till) is currently sitting
// on, so the picker can warn against tapping that one by mistake.
// window.screenLeft/screenTop are the window's position in desktop
// coordinates, the same space the Window Management API reports monitors in.
function hostScreenIndex(screens: ScreenPlacement[]): number | null {
  const x = window.screenLeft ?? window.screenX;
  const y = window.screenTop ?? window.screenY;
  const index = screens.findIndex(
    (s) => x >= s.left && x < s.left + s.width && y >= s.top && y < s.top + s.height,
  );
  return index === -1 ? null : index;
}

// Opens the display window on a specific physical screen and remembers it —
// called either automatically (a remembered screen still exists) or after the
// cashier taps one in the picker.
//
// Sized to the screen's full width/height — not availWidth/availHeight —
// specifically so the window already covers the monitor edge to edge the
// moment it opens, with no further action needed on that screen at all. The
// customer screen on a two-screen monoblock is a plain display with no touch
// and often no mouse reaching it, so anything that required a tap or click
// over there (a "go fullscreen" button, F11) was never actually usable — this
// is why that button was removed once already.
export function openCustomerDisplayOnScreen(screen: ScreenPlacement): OpenOutcome {
  const features = `left=${screen.left},top=${screen.top},width=${screen.width},height=${screen.height}`;
  const win = window.open("/customer", "aramir-customer", features);
  if (!win) return { kind: "blocked" };
  // Some browsers clamp a popup's initial size/position to the screen it
  // opened from, ignoring left/top/width/height in the features string the
  // first time — resizing after the fact still lands it correctly.
  try {
    win.moveTo(screen.left, screen.top);
    win.resizeTo(screen.width, screen.height);
  } catch {
    // Cross-origin or otherwise refused; the features string above was still
    // the first attempt and may have already worked.
  }
  rememberScreen(screen);
  return { kind: "placed" };
}

// Placing the customer window needs the Window Management API, which asks
// the user for permission the first time.
export async function openCustomerDisplay(): Promise<OpenOutcome> {
  const url = "/customer";
  const screens = await detectedScreens();
  if (!screens) {
    // Permission refused or the API is missing — a plain window rather than
    // leaving the cashier with nothing; it can still be dragged by hand.
    return window.open(url, "aramir-customer") ? { kind: "opened" } : { kind: "blocked" };
  }
  if (screens.length < 2) {
    return window.open(url, "aramir-customer") ? { kind: "single-screen" } : { kind: "blocked" };
  }
  const remembered = rememberedSignature();
  const match = remembered ? screens.find((s) => screenSignature(s) === remembered) : undefined;
  if (match) return openCustomerDisplayOnScreen(match);
  return { kind: "needs-pick", screens, hostIndex: hostScreenIndex(screens) };
}
