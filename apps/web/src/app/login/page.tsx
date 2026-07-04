"use client";

import { FormEvent, useState } from "react";
import { useAuth, ApiError } from "@/lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("owner@bakery.demo");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
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
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-xl font-semibold text-accent-foreground">
            Б
          </div>
          <h1 className="text-xl font-semibold text-foreground">Bakery OS</h1>
          <p className="mt-1 text-sm text-muted">Платформа управления сетью пекарен</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-surface p-6 shadow-card"
        >
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="you@company.com"
            />
          </div>

          <div className="mb-5">
            <label
              className="mb-1.5 block text-sm font-medium text-foreground"
              htmlFor="password"
            >
              Пароль
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="••••••••"
            />
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

        <p className="mt-4 text-center text-xs text-muted">
          Демо-доступ: owner@bakery.demo / password123
        </p>
      </div>
    </main>
  );
}
