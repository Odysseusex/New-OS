"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { X } from "lucide-react";
import { canOpen, primaryNav, secondaryNav } from "@/lib/nav";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const NOTIFICATIONS_POLL_MS = 60_000;

// Always beside the page on a wide screen; on a phone / narrow tablet a drawer
// over the page, opened from the topbar's menu button (`open`).
export function Sidebar({
  open = false,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.notifications
        .list()
        .then((list) => {
          if (!cancelled) setUnreadCount(list.length);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, NOTIFICATIONS_POLL_MS);
    window.addEventListener("notifications-updated", load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("notifications-updated", load);
    };
  }, [pathname]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={clsx(
          // A phone gets the whole screen (a grid of big tiles), a tablet a side drawer.
          "flex h-screen h-[100dvh] w-full shrink-0 flex-col border-r border-border bg-surface md:w-64",
          "fixed inset-y-0 left-0 z-50 transition-transform lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0 shadow-card" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="ArAmir OS"
            className="h-9 w-9 shrink-0 rounded-xl object-cover"
          />
          <div>
            <p className="text-sm font-semibold leading-tight text-foreground">
              ArAmir OS
            </p>
            <p className="text-xs leading-tight text-muted">Управление сетью</p>
          </div>
          <button
            onClick={onClose}
            title="Закрыть меню"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-foreground lg:hidden"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 pb-24 md:pb-2">
          <ul className="grid grid-cols-3 gap-2 md:block md:space-y-0.5">
            {primaryNav
              .filter((item) => !user || canOpen(item, user.role))
              .map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  active={pathname === item.href}
                />
              ))}
          </ul>

          <div className="my-3 border-t border-border" />

          <ul className="grid grid-cols-3 gap-2 md:block md:space-y-0.5">
            {secondaryNav
              .filter((item) => !user || canOpen(item, user.role))
              .map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  active={pathname === item.href}
                  badgeCount={item.href === "/notifications" ? unreadCount : 0}
                />
              ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

function NavRow({
  item,
  active,
  badgeCount = 0,
}: {
  item: (typeof primaryNav)[number];
  active: boolean;
  badgeCount?: number;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        className={clsx(
          "group relative flex h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border px-1 text-center text-xs transition",
          "md:h-auto md:flex-row md:justify-start md:gap-2.5 md:rounded-xl md:border-0 md:px-2.5 md:py-2 md:text-left md:text-sm",
          active
            ? "bg-surface-muted font-medium text-foreground"
            : "text-muted hover:bg-surface-muted hover:text-foreground",
        )}
      >
        <Icon className="h-5 w-5 shrink-0 md:h-4 md:w-4" strokeWidth={1.75} />
        <span className="line-clamp-2 leading-tight md:line-clamp-none md:flex-1 md:truncate">{item.label}</span>
        {item.status === "soon" && (
          <span className="absolute right-1 top-1 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted group-hover:bg-background md:static">
            скоро
          </span>
        )}
        {badgeCount > 0 && (
          <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground md:static">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </Link>
    </li>
  );
}
