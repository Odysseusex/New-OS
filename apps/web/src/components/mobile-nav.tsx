"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Menu } from "lucide-react";
import { allNavItems, canOpen } from "@/lib/nav";
import { useAuth } from "@/lib/auth-context";

// The phone's bottom bar: the four sections opened most, under the thumb, and «Меню» for the
// rest. Which four depends on the role (an operator has no dashboard), taken in this order.
const SHORTCUTS = ["/dashboard", "/sales", "/inventory", "/production", "/procurement", "/finance"];

export function MobileNav({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const pathname = usePathname();
  const { user } = useAuth();
  if (!user) return null;
  const items = SHORTCUTS.map((href) => allNavItems.find((item) => item.href === href))
    .filter((item): item is (typeof allNavItems)[number] => !!item && canOpen(item, user.role))
    .slice(0, 4);
  const cell = "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[0.625rem] leading-tight";

  return (
    // Above the open menu (so «Меню» closes it), below any window otherwise.
    <nav className={clsx("mobile-nav fixed inset-x-0 bottom-0 flex border-t border-border bg-surface md:hidden print:hidden", menuOpen ? "z-[51]" : "z-30")}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = !menuOpen && (pathname === item.href || pathname.startsWith(`${item.href}/`));
        return (
          <Link key={item.href} href={item.href} className={clsx(cell, active ? "font-medium text-accent" : "text-muted")}>
            <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.75} />
            <span className="whitespace-nowrap tracking-tight">{item.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onMenu} className={clsx(cell, menuOpen ? "font-medium text-accent" : "text-muted")}>
        <Menu className="h-5 w-5" strokeWidth={menuOpen ? 2 : 1.75} />
        <span>Меню</span>
      </button>
    </nav>
  );
}
