"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, FlaskConical, KeyRound, Trash2 } from "lucide-react";
import type { DemoCompanyCredentialsDto, DemoCompanyStatusDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";

const POLL_MS = 4000;

const formatDay = (key: string | null) => (key ? key.split("-").reverse().join(".") : "");

// «Песочница»: a separate demo company with invented data for someone to explore
// the platform. Owner only — the endpoints behind it say the same.
export function DemoCompanyCard() {
  const [status, setStatus] = useState<DemoCompanyStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<DemoCompanyCredentialsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.demoCompany
      .status()
      .then((s) => {
        setStatus(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Не удалось узнать состояние песочницы"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While the history is being filled in, keep the progress moving.
  useEffect(() => {
    if (status?.state !== "GENERATING") return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [status?.state, load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
      load();
    }
  }

  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const state = status?.state;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FlaskConical className="h-4 w-4" strokeWidth={1.75} />
            Песочница
          </h2>
          {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
          {state === "NONE" && (
            <p className="mt-2 text-sm text-muted">Отдельная демо-компания с выдуманными данными за два месяца, вход с полным доступом. Ваших данных в ней нет.</p>
          )}
          {state === "GENERATING" && status?.progress && (
            <div className="mt-2 w-72 max-w-full">
              <p className="text-sm text-muted">
                Заполняется: {status.progress.done} из {status.progress.total} дн. Не закрывайте страницу до окончания.
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((status.progress.done / status.progress.total) * 100)}%` }} />
              </div>
            </div>
          )}
          {state === "READY" && (
            <p className="mt-2 text-sm text-muted">
              {status?.name} · вход: <span className="font-medium text-foreground">{status?.email}</span>
            </p>
          )}
          {(state === "INTERRUPTED" || state === "FAILED") && (
            <p className="mt-2 text-sm text-amber-700">
              Заполнение прервалось{status?.error ? `: ${status.error}` : ""}. Удалите песочницу и создайте заново.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {state === "NONE" && (
            <button
              onClick={() => run(async () => setCredentials(await api.demoCompany.create()))}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              <FlaskConical className="h-4 w-4" strokeWidth={1.75} />
              {busy ? "Создаю…" : "Создать песочницу"}
            </button>
          )}
          {state === "READY" && (
            <button
              onClick={() => run(async () => setCredentials(await api.demoCompany.resetPassword()))}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-60"
            >
              <KeyRound className="h-4 w-4" strokeWidth={1.75} />
              Новый пароль
            </button>
          )}
          {(state === "READY" || state === "INTERRUPTED" || state === "FAILED") && (
            <button
              onClick={() => {
                if (!window.confirm("Удалить песочницу со всеми её данными? Ваши настоящие данные не затрагиваются.")) return;
                void run(async () => {
                  await api.demoCompany.remove();
                  setCredentials(null);
                });
              }}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              {busy ? "Удаляю…" : "Удалить"}
            </button>
          )}
        </div>
      </div>

      {credentials && (
        <div className="mt-4 rounded-xl bg-surface-muted p-4 text-sm">
          <p className="font-medium text-foreground">Вход в песочницу — пароль показан один раз, сохраните его</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Адрес</dt>
            <dd className="break-all text-foreground">{loginUrl}</dd>
            <dt className="text-muted">Логин</dt>
            <dd className="break-all font-mono text-foreground">{credentials.email}</dd>
            <dt className="text-muted">Пароль</dt>
            <dd className="font-mono text-foreground">{credentials.password}</dd>
          </dl>
          <button
            onClick={() => void navigator.clipboard?.writeText(`${loginUrl}\nЛогин: ${credentials.email}\nПароль: ${credentials.password}`)}
            className="mt-3 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            Скопировать
          </button>
          {state === "GENERATING" && <p className="mt-2 text-xs text-muted">Войти можно, когда заполнение закончится.</p>}
        </div>
      )}

      {state === "READY" && status?.periodFrom && (
        <p className="mt-3 text-xs text-muted">
          Данные с {formatDay(status.periodFrom)} по {formatDay(status.periodTo)}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
