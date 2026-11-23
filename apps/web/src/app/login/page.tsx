"use client";

import { FormEvent, useState } from "react";
import { Keyboard } from "lucide-react";
import { useAuth, ApiError } from "@/lib/auth-context";
import { TextKeypadModal } from "@/components/text-keypad";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The till's monoblocks have the system keyboard switched off: a key icon in each field opens our own.
  const [keypad, setKeypad] = useState<"email" | "password" | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      // Coming from a page that needed a login (e.g. /crm) goes back there.
      const next = new URLSearchParams(window.location.search).get("next");
      await login(email, password, next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти. Попробуйте ещё раз.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="ArAmir OS"
            className="mx-auto mb-4 h-12 w-12 rounded-2xl object-cover"
          />
          <h1 className="text-xl font-semibold text-foreground">ArAmir OS</h1>
          <p className="mt-1 text-sm text-muted">Платформа управления пекарней Ar-Amir</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-surface p-6 shadow-card"
        >
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="email">
              Email
            </label>
            <div className="relative">
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface py-2 pl-3 pr-12 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="you@company.com"
            />
            <button
              type="button"
              onClick={() => setKeypad("email")}
              aria-label="Клавиатура для email"
              title="Экранная клавиатура"
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
            >
              <Keyboard className="h-5 w-5" strokeWidth={1.75} />
            </button>
            </div>
          </div>

          <div className="mb-5">
            <label
              className="mb-1.5 block text-sm font-medium text-foreground"
              htmlFor="password"
            >
              Пароль
            </label>
            <div className="relative">
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface py-2 pl-3 pr-12 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setKeypad("password")}
              aria-label="Клавиатура для пароля"
              title="Экранная клавиатура"
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
            >
              <Keyboard className="h-5 w-5" strokeWidth={1.75} />
            </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
      {keypad && (
        <TextKeypadModal
          title={keypad === "email" ? "Email" : "Пароль"}
          initial={keypad === "email" ? email : password}
          placeholder={keypad === "email" ? "you@company.com" : ""}
          latin
          secret={keypad === "password"}
          onClose={() => setKeypad(null)}
          onDone={(v) => {
            if (keypad === "email") setEmail(v.trim());
            else setPassword(v);
            setKeypad(null);
          }}
        />
      )}
    </main>
  );
}
