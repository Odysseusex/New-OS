"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { primaryNav, secondaryNav } from "@/lib/nav";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="ArAmir OS"
          className="h-9 w-9 shrink-0 rounded-xl object-cover"
        />
        <div>
          <p className="text-sm font-semibold leading-tight text-foreground">ArAmir OS</p>
          <p className="text-xs leading-tight text-muted">Управление сетью</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {primaryNav.map((item) => (
            <NavRow key={item.href} item={item} active={pathname === item.href} />
          ))}
        </ul>

        <div className="my-3 border-t border-border" />

        <ul className="space-y-0.5">
          {secondaryNav.map((item) => (
            <NavRow key={item.href} item={item} active={pathname === item.href} />
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function NavRow({
  item,
  active,
}: {
  item: (typeof primaryNav)[number];
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        className={clsx(
          "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition",
          active
            ? "bg-surface-muted font-medium text-foreground"
            : "text-muted hover:bg-surface-muted hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1 truncate">{item.label}</span>
        {item.status === "soon" && (
          <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted group-hover:bg-background">
            скоро
          </span>
        )}
      </Link>
    </li>
  );
}
