"use client";

import { api } from "@/lib/api";

// Notifications on a baker's phone (standard Web Push, like the customer app): «Рейс 2: ждём вас».

const SW_URL = "/baker/sw.js";

export type PushState = "unsupported" | "needs-install" | "blocked" | "off" | "on";

const b64url = (buf: ArrayBuffer | null) => {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// The page /baker is outside the worker's folder (/baker/): wait for this registration, not `ready`.
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

const tellServer = (sub: PushSubscription) => api.baker.pushSubscribe({ endpoint: sub.endpoint, p256dh: b64url(sub.getKey("p256dh")), auth: b64url(sub.getKey("auth")) });

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

// At every opening: the phone follows whoever is signed in now (two bakers may share a phone).
export async function syncPush(): Promise<void> {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const sub = await existing();
    if (!sub) return;
    const { publicKey } = await api.baker.pushKey();
    if (b64url(sub.options.applicationServerKey) !== publicKey) {
      await sub.unsubscribe();
      const reg = await activeRegistration();
      await tellServer(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
      return;
    }
    await tellServer(sub);
  } catch {
    // the next opening tries again
  }
}

// From a tap: the browser asks for permission.
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const [{ publicKey }, reg] = await Promise.all([api.baker.pushKey(), activeRegistration()]);
  const old = await reg.pushManager.getSubscription();
  if (old && b64url(old.options.applicationServerKey) !== publicKey) await old.unsubscribe();
  await tellServer(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
  return "on";
}
