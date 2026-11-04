"use client";

import { LogOut, Menu } from "lucide-react";
import { ROLE_LABELS_RU } from "@bakery-os/shared";
import { useAuth } from "@/lib/auth-context";

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <button
            onClick={onMenu}
            title="Меню"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground transition hover:bg-surface-muted lg:hidden"
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{user.organization.name}</p>
          <p className="text-xs text-muted">Вся сеть</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight text-foreground">{user.fullName}</p>
          <p className="text-xs leading-tight text-muted">{user.title || ROLE_LABELS_RU[user.role]}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-sm font-medium text-foreground">
          {user.fullName.charAt(0)}
        </div>
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
