"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Cake, LayoutGrid, Layers, LogOut, Menu, Moon, Sun, Sunrise, Users } from "lucide-react";
import { CRM_ROLES, CrmOrderStage, Role, ROLE_LABELS_RU } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Avatar, WheatIcon } from "./ui";

type Theme = "light" | "dark";
const THEME_KEY = "crm_theme";

interface CrmContextValue {
  theme: Theme;
  refreshCounts: () => void;
}

const CrmContext = createContext<CrmContextValue>({ theme: "light", refreshCounts: () => undefined });
export const useCrm = () => useContext(CrmContext);

const NAV = [
  { href: "/crm", label: "Сегодня", icon: Sunrise, color: "orange", countKey: "today" as const },
  { href: "/crm/clients", label: "Клиенты", icon: Users, color: "blue" },
  { href: "/crm/groups", label: "Группы", icon: Layers, color: "purple" },
  { href: "/crm/orders", label: "Торты на заказ", icon: Cake, color: "pink", countKey: "orders" as const },
];

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function CrmShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("light");
  const [menuOpen, setMenuOpen] = useState(false);
  const [counts, setCounts] = useState<{ today: number | null; orders: number | null }>({ today: null, orders: null });

  useEffect(() => setTheme(readTheme()), []);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!isLoading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, user, router, pathname]);

  const allowed = !!user && CRM_ROLES.includes(user.role);

  const refreshCounts = useCallback(() => {
    if (!allowed) return;
    api.crm.today().then((t) => setCounts((c) => ({ ...c, today: t.stats.toContact }))).catch(() => undefined);
    api.crm
      .orders()
      .then((o) => setCounts((c) => ({ ...c, orders: o.filter((x) => x.stage !== CrmOrderStage.DONE && x.stage !== CrmOrderStage.CANCELLED).length })))
      .catch(() => undefined);
  }, [allowed]);
  useEffect(() => refreshCounts(), [refreshCounts]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* the choice just isn't remembered */
    }
  };

  if (isLoading || !user) {
    return (
      <div className={`crm ${theme}`} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="muted">Загрузка…</span>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className={`crm ${theme}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div className="crm-panel" style={{ padding: 24, maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 className="crm-h2">Нет доступа к CRM</h1>
          <span className="tx2">Роль «{ROLE_LABELS_RU[user.role]}» не работает с клиентской базой.</span>
          <Link href="/" className="crm-btn" style={{ alignSelf: "flex-start" }}>
            Вернуться в ArAmir OS
          </Link>
        </div>
      </div>
    );
  }

  const isActive = (href: string) => (href === "/crm" ? pathname === "/crm" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <CrmContext.Provider value={{ theme, refreshCounts }}>
      <div className={`crm ${theme}`}>
        <div className="crm-shell">
          {menuOpen && <div className="crm-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
          <aside className={`crm-side${menuOpen ? " open" : ""}`} aria-label="Меню CRM">
            <div className="crm-ws">
              <span className="crm-logo">
                <WheatIcon size={15} />
              </span>
              <span>Ар Амир</span>
              <span className="crm-mini" style={{ marginLeft: 2 }}>
                CRM
              </span>
            </div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {NAV.map((n) => {
                const count = n.countKey ? counts[n.countKey] : null;
                return (
                  <Link key={n.href} href={n.href} className={`crm-si${isActive(n.href) ? " on" : ""}`}>
                    <span className="crm-tile" style={{ background: `var(--${n.color}-bg)`, color: `var(--${n.color})` }}>
                      <n.icon size={14} strokeWidth={2.2} />
                    </span>
                    <span>{n.label}</span>
                    {count ? <span className="count">{count}</span> : null}
                  </Link>
                );
              })}
            </nav>

            <div className="crm-grp">Платформа</div>
            {user.role !== Role.CLIENT_MANAGER && (
              <Link href="/dashboard" className="crm-si">
                <span className="crm-tile" style={{ background: "var(--gray-bg)", color: "var(--tx2)" }}>
                  <LayoutGrid size={14} strokeWidth={2.2} />
                </span>
                <span>ArAmir OS</span>
              </Link>
            )}
            <button type="button" className="crm-si" onClick={toggleTheme}>
              <span className="crm-tile" style={{ background: "var(--yellow-bg)", color: "var(--yellow)" }}>
                {theme === "light" ? <Moon size={14} strokeWidth={2.2} /> : <Sun size={14} strokeWidth={2.2} />}
              </span>
              <span>{theme === "light" ? "Тёмная тема" : "Светлая тема"}</span>
            </button>

            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "10px 8px 4px" }}>
              <Avatar name={user.fullName} size={28} />
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.fullName}</span>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {user.title ?? ROLE_LABELS_RU[user.role]}
                </span>
              </div>
              <button type="button" className="crm-ib" onClick={logout} aria-label="Выйти" title="Выйти">
                <LogOut size={16} />
              </button>
            </div>
          </aside>

          <div className="crm-main">
            <div className="crm-mobilebar">
              <button type="button" className="crm-ib" onClick={() => setMenuOpen(true)} aria-label="Меню">
                <Menu size={18} />
              </button>
              <span className="crm-logo">
                <WheatIcon size={15} />
              </span>
              <span style={{ fontWeight: 600 }}>Ар Амир CRM</span>
            </div>
            {children}
          </div>
        </div>
      </div>
    </CrmContext.Provider>
  );
}
