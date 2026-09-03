"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Role } from "@bakery-os/shared";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

// CASHIER is locked to the till screen only — no sidebar, no other route.
// This is a device-lockdown concern (a shop-floor till shouldn't browse
// Finance/Settings), separate from the API's own @Roles(...) checks, which
// still gate every write regardless of what the frontend shows.
const CASHIER_ONLY_ROUTE = "/pos";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isCashier = user?.role === Role.CASHIER;

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (isCashier && pathname !== CASHIER_ONLY_ROUTE) {
      router.replace(CASHIER_ONLY_ROUTE);
    }
  }, [isCashier, pathname, router]);

  if (isLoading || !user || (isCashier && pathname !== CASHIER_ONLY_ROUTE)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {!isCashier && (
        <div className="print:hidden">
          <Sidebar />
        </div>
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="print:hidden">
          <Topbar />
        </div>
        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
