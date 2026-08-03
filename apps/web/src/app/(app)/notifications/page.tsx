"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, Bell, Check, CheckCheck } from "lucide-react";
import type { NotificationDto } from "@bakery-os/shared";
import { NotificationSeverity } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const SEVERITY_STYLES: Record<NotificationSeverity, { badge: string; dot: string }> = {
  [NotificationSeverity.CRITICAL]: { badge: "bg-red-50 text-red-700", dot: "bg-red-500" },
  [NotificationSeverity.WARNING]: { badge: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  [NotificationSeverity.INFO]: { badge: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
};

const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  [NotificationSeverity.CRITICAL]: "Критично",
  [NotificationSeverity.WARNING]: "Внимание",
  [NotificationSeverity.INFO]: "Информация",
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);

  const load = useCallback(() => {
    api.notifications
      .list()
      .then(setNotifications)
      .catch(() => setError("Не удалось загрузить уведомления"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDismiss(key: string) {
    setDismissingKey(key);
    try {
      await api.notifications.dismiss(key);
      setNotifications((prev) => prev.filter((n) => n.key !== key));
      window.dispatchEvent(new Event("notifications-updated"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отметить уведомление");
    } finally {
      setDismissingKey(null);
    }
  }

  async function handleDismissAll() {
    try {
      await api.notifications.dismissAll();
      setNotifications([]);
      window.dispatchEvent(new Event("notifications-updated"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отметить уведомления");
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Уведомления</h1>
          <p className="mt-1 text-sm text-muted">Лента алертов по всей сети</p>
        </div>
        {notifications.length > 0 && (
          <button
            onClick={handleDismissAll}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
          >
            <CheckCheck className="h-4 w-4" strokeWidth={1.75} />
            Прочитать всё
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!isLoading && notifications.length === 0 && (
        <div className="flex flex-col items-center rounded-2xl border border-border bg-surface py-20 text-center shadow-card">
          <Bell className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} />
          <p className="text-sm font-medium text-foreground">Уведомлений нет</p>
          <p className="mt-1 text-sm text-muted">Всё в порядке — активных алертов не найдено</p>
        </div>
      )}

      <div className="space-y-2.5">
        {notifications.map((n) => {
          const style = SEVERITY_STYLES[n.severity];
          return (
            <div
              key={n.key}
              className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card"
            >
              <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", style.badge)}>
                    {SEVERITY_LABELS[n.severity]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{n.message}</p>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                  <span>{formatDateTime(n.createdAt)}</span>
                  <Link href={n.link} className="font-medium text-accent hover:underline">
                    Перейти
                  </Link>
                </div>
              </div>
              <button
                onClick={() => handleDismiss(n.key)}
                disabled={dismissingKey === n.key}
                title="Отметить прочитанным"
                className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
              >
                <Check className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>

      {!isLoading && notifications.some((n) => n.severity === NotificationSeverity.CRITICAL) && (
        <div className="mt-6 flex items-center gap-2 text-xs text-muted">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
          Есть критичные уведомления — рекомендуем разобрать в первую очередь
        </div>
      )}
    </div>
  );
}
