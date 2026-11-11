"use client";

import { LogOut, Menu, RefreshCw } from "lucide-react";
import { ROLE_LABELS_RU } from "@bakery-os/shared";
import { useAuth } from "@/lib/auth-context";
import { reloadPage } from "@/lib/refresh";

// `phoneMenu`: on a phone the menu is opened from the bottom bar; a screen without that bar
// (the till) keeps the button here.
export function Topbar({ onMenu, phoneMenu = false }: { onMenu?: () => void; phoneMenu?: boolean }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3 sm:px-6 md:h-16">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <button
            onClick={onMenu}
            title="Меню"
            className={`-ml-1 h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground transition hover:bg-surface-muted md:flex lg:hidden ${phoneMenu ? "flex" : "hidden"}`}
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{user.organization.name}</p>
          <p className="hidden text-xs text-muted md:block">Вся сеть</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight text-foreground">{user.fullName}</p>
          <p className="text-xs leading-tight text-muted">{user.title || ROLE_LABELS_RU[user.role]}</p>
        </div>
        <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-sm font-medium text-foreground md:flex">
          {user.fullName.charAt(0)}
        </div>
        <button
          onClick={reloadPage}
          title="Обновить"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={logout}
          title="Выйти"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
