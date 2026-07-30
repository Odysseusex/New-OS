"use client";

import { LogOut } from "lucide-react";
import { ROLE_LABELS_RU } from "@bakery-os/shared";
import { useAuth } from "@/lib/auth-context";

export function Topbar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <div>
        <p className="text-sm font-medium text-foreground">{user.organization.name}</p>
        <p className="text-xs text-muted">Вся сеть</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
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
