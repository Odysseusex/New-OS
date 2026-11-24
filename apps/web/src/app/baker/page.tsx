"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CurrentUserDto } from "@bakery-os/shared";
import { BAKER_NOTE_ROLES, BAKER_PHONE_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { homeFor } from "@/lib/nav";
import { PinPad } from "@/components/numeric-keypad";
import { BakerApp } from "./baker-app";

// The bakers' phone screen. A phone is connected ONCE with the baker's email and password (the owner
// does it) and keeps a device key; from then on the screen opens with a PIN, like the till.
const DEVICE_KEY = "baker_device_token";
const TOKEN_KEY = "bakery_token";

type Stage = "loading" | "connect" | "pin" | "ready" | "other";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export default function BakerPage() {
  const { user: signedIn, isLoading } = useAuth();
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [locked, setLocked] = useState(false);

  // A baker signed in on this phone leaves a device key behind, so tomorrow a PIN is enough.
  const keepDevice = useCallback((u: CurrentUserDto) => {
    if (!BAKER_PHONE_ROLES.includes(u.role) || read(DEVICE_KEY)) return;
    api.baker
      .device()
      .then((r) => localStorage.setItem(DEVICE_KEY, r.deviceToken))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isLoading || locked || stage !== "loading") return;
    if (signedIn && BAKER_NOTE_ROLES.includes(signedIn.role)) {
      setUser(signedIn);
      setStage("ready");
      keepDevice(signedIn);
    } else if (signedIn) {
      setStage("other");
    } else {
      setStage(read(DEVICE_KEY) ? "pin" : "connect");
    }
  }, [isLoading, signedIn, locked, stage, keepDevice]);

  const enter = useCallback(
    (token: string, u: CurrentUserDto) => {
      localStorage.setItem(TOKEN_KEY, token);
      setUser(u);
      setStage("ready");
      keepDevice(u);
    },
    [keepDevice],
  );

  // «Выйти» and an expired session both end at the PIN pad (or at connecting, on a phone without a key).
  const lock = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setLocked(true);
    setUser(null);
    setStage(read(DEVICE_KEY) ? "pin" : "connect");
  }, []);

  if (stage === "loading") return <Centered>Загрузка…</Centered>;
  if (stage === "other") {
    return (
      <Centered>
        <p className="mb-4 text-base text-foreground">Этот экран — для пекарей.</p>
        <Link href={signedIn ? homeFor(signedIn.role) : "/login"} className="rounded-2xl bg-accent px-6 py-3 text-base font-medium text-accent-foreground">
          Вернуться в программу
        </Link>
      </Centered>
    );
  }
  if (stage === "connect") return <Connect onDone={enter} />;
  if (stage === "pin") {
    return (
      <PinScreen
        onDone={enter}
        onReconnect={() => {
          localStorage.removeItem(DEVICE_KEY);
          setStage("connect");
        }}
      />
    );
  }
  return user ? <BakerApp user={user} onLock={lock} /> : null;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center px-6 text-center text-muted">{children}</main>;
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover" />
      <h1 className="text-2xl font-semibold text-foreground">Накладные</h1>
      <p className="mt-1 text-base text-muted">{subtitle}</p>
    </div>
  );
}

function PinScreen({ onDone, onReconnect }: { onDone: (token: string, user: CurrentUserDto) => void; onReconnect: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.baker.pinLogin(read(DEVICE_KEY) ?? "", pin);
      onDone(res.accessToken, res.user);
    } catch (err) {
      setPin("");
      if (err instanceof ApiError && /подключить заново/.test(err.message)) onReconnect();
      else setError(err instanceof ApiError ? err.message : "Нет связи. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-sm flex-col justify-center px-5 py-8">
      <Header subtitle="Введите свой PIN" />
      <form onSubmit={submit}>
        <PinPad value={pin} onChange={setPin} />
        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-center text-base text-red-700">{error}</p>}
        <button type="submit" disabled={pin.length < 4 || busy} className="mt-5 h-14 w-full rounded-2xl bg-accent text-lg font-semibold text-accent-foreground disabled:opacity-40">
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </main>
  );
}

function Connect({ onDone }: { onDone: (token: string, user: CurrentUserDto) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(email.trim(), password);
      if (!BAKER_NOTE_ROLES.includes(res.user.role)) {
        setError("Это вход не пекаря. Введите email и пароль пекаря.");
        return;
      }
      onDone(res.accessToken, res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Нет связи. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const field = "h-14 w-full rounded-2xl border border-border bg-surface px-4 text-lg text-foreground outline-none focus:border-accent";
  return (
    <main className="mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-sm flex-col justify-center px-5 py-8">
      <Header subtitle="Подключение телефона — один раз" />
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required autoComplete="username" placeholder="Email пекаря" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        <input type="password" required autoComplete="current-password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="h-14 w-full rounded-2xl bg-accent text-lg font-semibold text-accent-foreground disabled:opacity-40">
          {busy ? "Подключаем…" : "Подключить"}
        </button>
      </form>
    </main>
  );
}
