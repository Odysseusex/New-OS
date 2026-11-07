"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Role, TILL_ROLES } from "@bakery-os/shared";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { homeFor, isBlockedRoute } from "@/lib/nav";

// CASHIER is locked to the till screen only — no sidebar, no other route.
// This is a device-lockdown concern (a shop-floor till shouldn't browse
// Finance/Settings), separate from the API's own @Roles(...) checks, which
// still gate every write regardless of what the frontend shows.
const CASHIER_ONLY_ROUTE = "/pos";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isCashier = !!user && TILL_ROLES.includes(user.role);
  // The client manager works only in the CRM, which lives outside this layout.
  const isClientManager = user?.role === Role.CLIENT_MANAGER;
  // A page hidden from this role's menu (e.g. «Отчёты» for an operator) is not
  // reachable by typing its address either.
  const isBlocked = !!user && !isCashier && isBlockedRoute(pathname, user.role);
  // On a phone or a narrow tablet the menu is a drawer opened from the topbar.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (isClientManager) router.replace("/crm");
  }, [isClientManager, router]);

  useEffect(() => {
    if (isCashier && pathname !== CASHIER_ONLY_ROUTE) {
      router.replace(CASHIER_ONLY_ROUTE);
    }
  }, [isCashier, pathname, router]);

  useEffect(() => {
    if (isBlocked && user) router.replace(homeFor(user.role));
  }, [isBlocked, user, router]);

  if (isLoading || !user || (isCashier && pathname !== CASHIER_ONLY_ROUTE) || isBlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted">Загрузка…</p>
      </div>
    );
  }

  // The till draws its own rail and header (logout, «В систему»), edge to edge.
  const isTill = pathname === CASHIER_ONLY_ROUTE;

  return (
    <div className="flex h-screen bg-background">
      {!isCashier && !isTill && (
        <div className="print:hidden">
          <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!isTill && (
          <div className="print:hidden">
            <Topbar onMenu={isCashier ? undefined : () => setNavOpen(true)} />
          </div>
        )}
        <main className={isTill ? "flex-1 overflow-y-auto lg:overflow-hidden" : "flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-8"}>{children}</main>
      </div>
    </div>
  );
}
