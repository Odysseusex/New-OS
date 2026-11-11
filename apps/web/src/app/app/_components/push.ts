"use client";

import { clubApi } from "@/lib/club-api";

// Notifications of the customer app (standard Web Push). The phone asks its own
// push service for an address, and the bakery's server is told that address.

const SW_URL = "/app/sw.js";

export type PushState =
  // The browser cannot do it at all.
  | "unsupported"
  // iPhone: works only once the app is on the home screen.
  | "needs-install"
  // The customer said no in the browser; only they can change it, in the phone's settings.
  | "blocked"
  | "off"
  | "on";

const b64url = (buf: ArrayBuffer | null) => {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// The page at /app is not inside the worker's own folder (/app/), so
// `navigator.serviceWorker.ready` would never resolve here: wait for this one.
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(SW_URL);
  if (reg.active) return reg;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return reg;
  await new Promise<void>((resolve) => {
    const done = () => worker.state === "activated" && resolve();
    worker.addEventListener("statechange", done);
    done();
    window.setTimeout(resolve, 8000);
  });
  return reg;
}

async function existing(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return reg ? reg.pushManager.getSubscription() : null;
}

async function tellServer(sub: PushSubscription): Promise<void> {
  await clubApi.pushSubscribe({ endpoint: sub.endpoint, p256dh: b64url(sub.getKey("p256dh")), auth: b64url(sub.getKey("auth")) });
}

export async function pushState(): Promise<PushState> {
  try {
    if (!supported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
    if (isIos() && !isStandalone()) return "needs-install";
    if (Notification.permission === "denied") return "blocked";
    if (Notification.permission !== "granted") return "off";
    return (await existing()) ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

// On every opening of the app: the phone's address is confirmed to the server
// (it follows the member who is signed in), and renewed if the server's key changed.
export async function syncPush(): Promise<void> {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const sub = await existing();
    if (!sub) return;
    const { publicKey } = await clubApi.pushKey();
    if (b64url(sub.options.applicationServerKey) !== publicKey) {
      await sub.unsubscribe();
      const reg = await activeRegistration();
      await tellServer(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
      return;
    }
    await tellServer(sub);
  } catch {
    // a courtesy: the next opening tries again
  }
}

// Must be called from a tap (the browser asks the customer for permission).
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const [{ publicKey }, reg] = await Promise.all([clubApi.pushKey(), activeRegistration()]);
  const old = await reg.pushManager.getSubscription();
  if (old && b64url(old.options.applicationServerKey) !== publicKey) await old.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  await tellServer(sub);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  try {
    const sub = await existing();
    if (sub) {
      await clubApi.pushUnsubscribe(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe();
    }
  } catch {
    // nothing to undo
  }
  return pushState();
}
