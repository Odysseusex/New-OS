"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { BAKER_PRINT_ROLES, Role } from "@bakery-os/shared";
import { useAuth } from "@/lib/auth-context";
import { homeFor } from "@/lib/nav";
import { BakerDayTab } from "@/components/baker-day-tab";
import { RemotePrintAgent } from "@/components/remote-print";

// «Выдача накладных» (owner, 25.11.2026): the laptop by the door where drivers collect goods, with a
// printer. One screen — the day's bakers' notes, print and WhatsApp; nothing on it changes a note.
export default function DispatchPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login?next=/dispatch");
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return <p className="p-8 text-center text-sm text-muted">Загрузка…</p>;
  }
  if (!BAKER_PRINT_ROLES.includes(user.role)) {
    return (
      <div className="p-8 text-center">
        <p className="mb-4 text-sm text-foreground">Этот экран — для выдачи накладных.</p>
        <Link href={homeFor(user.role)} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
          Вернуться в программу
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-foreground">Накладные пекарей</h1>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted">{user.fullName}</span>
          <button type="button" onClick={logout} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-muted">
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            Выйти
          </button>
        </div>
      </div>
      {/* Only the laptop's own login prints requests sent from elsewhere. */}
      {user.role === Role.DISPATCHER && <RemotePrintAgent />}
      <BakerDayTab printOnly />
    </div>
  );
}
