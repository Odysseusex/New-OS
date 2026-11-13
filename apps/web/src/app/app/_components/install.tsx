"use client";

import { useEffect, useState } from "react";
import { ArrowDown, Check, Copy, Download, MoreHorizontal, MoreVertical, PlusSquare, Share } from "lucide-react";

// Before sign-in in a phone's BROWSER: «add the app to your home screen first».
// The sign-in form then appears in the app opened from its icon (on an iPhone a
// home-screen app has its own storage, so a sign-in made in Safari would be
// asked again there). Soft: «Продолжить в браузере» stays for a phone where
// the installation did not work out.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Chrome fires its install offer once, soon after the page loads — caught here,
// at import, long before the gate is on screen.
let offer: InstallEvent | null = null;
let installed = false;
const watchers = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    offer = e as InstallEvent;
    watchers.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    offer = null;
    watchers.forEach((f) => f());
  });
}

export interface InstallEnv {
  os: "ios" | "android";
  // Opened inside another app (Instagram, Telegram…): nothing can be installed from there.
  inApp: boolean;
  safari: boolean;
  // Safari 26+: «Поделиться» sits behind «•••».
  compactSafari: boolean;
  ipad: boolean;
}

const SKIP_KEY = "aa.club.installSkipped";
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|Telegram|TikTok|musical_ly|Bytedance|Line\/|VKClient|; wv\)/i;

export function isStandalone(): boolean {
  try {
    return (
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches
    );
  } catch {
    return false;
  }
}

// The phone this page is open on, or null when no gate is due (already the
// installed app, a computer, or the person chose to stay in the browser).
export function installEnv(): InstallEnv | null {
  try {
    if (isStandalone()) return null;
    if (sessionStorage.getItem(SKIP_KEY) === "1") return null;
    const ua = navigator.userAgent;
    const ipad = /ipad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (/iphone|ipod/i.test(ua) || ipad) {
      const other = /CriOS|FxiOS|EdgiOS|YaBrowser|OPiOS|OPT\//i.test(ua);
      const inApp = IN_APP.test(ua) || !/Safari\//i.test(ua);
      const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
      return { os: "ios", inApp, safari: !inApp && !other, compactSafari: version >= 26, ipad };
    }
    if (/android/i.test(ua)) return { os: "android", inApp: IN_APP.test(ua), safari: false, compactSafari: false, ipad: false };
    return null;
  } catch {
    return null;
  }
}

export function InstallGate({ env, onSkip }: { env: InstallEnv; onSkip: () => void }) {
  const skip = () => {
    try {
      sessionStorage.setItem(SKIP_KEY, "1");
    } catch {
      // asked again after a reload, nothing worse
    }
    onSkip();
  };

  return (
    <main className="aa-frame no-tabs aa-fade aa-install">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", paddingTop: 18 }}>
        <img src="/site/app/icon-192.png" alt="Ar Amir" className="aa-install-icon" />
        <span className="aa-eyebrow">Бонусная карта</span>
        <h1 className="aa-h1" style={{ fontSize: 32 }}>
          Добавьте Ar Amir на экран телефона
        </h1>
        <p className="aa-sub" style={{ maxWidth: 340 }}>
          Карта будет открываться со значка, как обычное приложение.
        </p>
      </div>

      {env.inApp ? <InApp env={env} /> : env.os === "android" ? <Android /> : <Ios env={env} />}

      <button type="button" className="aa-link" style={{ alignSelf: "center" }} onClick={skip}>
        Продолжить в браузере
      </button>
      {env.os === "ios" && env.safari && !env.inApp && !env.ipad && (
        <div className="aa-install-arrow" aria-hidden>
          <ArrowDown size={26} />
        </div>
      )}
    </main>
  );
}

function Android() {
  const [, tick] = useState(0);
  const [state, setState] = useState<"idle" | "installing" | "manual">("idle");
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    watchers.add(f);
    // A browser that makes no offer of its own (or the app is already there): the way by hand.
    const id = window.setTimeout(() => setState((s) => (s === "idle" && !offer ? "manual" : s)), 3500);
    return () => {
      watchers.delete(f);
      window.clearTimeout(id);
    };
  }, []);

  const install = async () => {
    const e = offer;
    if (!e) {
      setState("manual");
      return;
    }
    try {
      await e.prompt();
      const choice = await e.userChoice;
      offer = null;
      setState(choice.outcome === "accepted" ? "installing" : "manual");
    } catch {
      setState("manual");
    }
  };

  if (installed || state === "installing") {
    return (
      <section className="aa-panel aa-install-done">
        <Check size={28} />
        <b>{installed ? "Готово" : "Устанавливается…"}</b>
        <p>Значок Ar Amir {installed ? "уже на экране телефона" : "появится на экране телефона через несколько секунд"}. Откройте приложение с него и войдите по номеру.</p>
      </section>
    );
  }
  return (
    <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {(offer || state === "idle") && (
        <button type="button" className="aa-btn primary" onClick={install}>
          <Download size={20} /> Установить приложение
        </button>
      )}
      {state === "manual" && (
        <ol className="aa-steps">
          <li>
            <b>1</b>
            <span>
              Откройте меню браузера <MoreVertical size={16} className="aa-ic" /> вверху или внизу экрана.
            </span>
          </li>
          <li>
            <b>2</b>
            <span>Выберите «Добавить на гл. экран» или «Установить приложение».</span>
          </li>
          <li>
            <b>3</b>
            <span>Откройте Ar Amir со значка и войдите по номеру.</span>
          </li>
        </ol>
      )}
      {state === "manual" && <p className="aa-muted" style={{ margin: 0, fontSize: 13 }}>Значок Ar Amir уже есть на экране телефона? Откройте приложение с него.</p>}
    </section>
  );
}

function Ios({ env }: { env: InstallEnv }) {
  return (
    <section className="aa-panel">
      <ol className="aa-steps">
        {env.safari && env.compactSafari && (
          <li>
            <b>1</b>
            <span>
              Нажмите <MoreHorizontal size={18} className="aa-ic" /> внизу экрана.
            </span>
          </li>
        )}
        <li>
          <b>{env.safari && env.compactSafari ? 2 : 1}</b>
          <span>
            Нажмите «Поделиться» <Share size={17} className="aa-ic" />
            {env.safari ? (env.compactSafari ? "." : env.ipad ? " вверху экрана." : " внизу экрана.") : " в строке адреса или в меню браузера."}
            {env.safari && !env.compactSafari && !env.ipad && (
              <span className="aa-step-note">
                Нет такого значка? Сначала нажмите <MoreHorizontal size={15} className="aa-ic" />
              </span>
            )}
          </span>
        </li>
        <li>
          <b>{env.safari && env.compactSafari ? 3 : 2}</b>
          <span>
            Пролистайте вниз и выберите «На экран „Домой“» <PlusSquare size={17} className="aa-ic" />, затем «Добавить».
          </span>
        </li>
        <li>
          <b>{env.safari && env.compactSafari ? 4 : 3}</b>
          <span>Откройте Ar Amir со значка и войдите по номеру.</span>
        </li>
      </ol>
    </section>
  );
}

// Inside Instagram / Telegram and the like: the page has to be opened in the
// phone's real browser first.
function InApp({ env }: { env: InstallEnv }) {
  const [copied, setCopied] = useState(false);
  const href = typeof window === "undefined" ? "" : `${window.location.origin}/app`;
  const browser = env.os === "ios" ? "Safari" : "Chrome";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0 }}>
        Эта страница открыта внутри другого приложения. Откройте её в {browser} — там Ar Amir добавляется на экран телефона.
      </p>
      {env.os === "android" && (
        <a className="aa-btn primary" href={`intent://${href.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`}>
          Открыть в Chrome
        </a>
      )}
      <ol className="aa-steps">
        <li>
          <b>1</b>
          <span>
            Нажмите <MoreHorizontal size={18} className="aa-ic" /> или <MoreVertical size={16} className="aa-ic" /> в углу экрана.
          </span>
        </li>
        <li>
          <b>2</b>
          <span>Выберите «Открыть в {browser}» или «Открыть в браузере».</span>
        </li>
      </ol>
      <button type="button" className="aa-btn ghost" onClick={copy}>
        {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
      </button>
    </section>
  );
}
