import type { LucideIcon } from "lucide-react";
import { CRM_ROLES, REVENUE_VIEW_ROLES, Role } from "@bakery-os/shared";
import {
  LayoutDashboard,
  Sparkles,
  ScanLine,
  TrendingUp,
  Factory,
  Package,
  ShoppingCart,
  Truck,
  Map,
  Wallet,
  Target,
  Users,
  AlertTriangle,
  Handshake,
  Store,
  BarChart3,
  Plug,
  Bell,
  Settings,
  HeartHandshake,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  status: "live" | "soon";
  description: string;
  // Only these roles see the item and may open the page; absent = everyone.
  // The API gates the same data with the same array.
  roles?: Role[];
}

export const primaryNav: NavItem[] = [
  {
    href: "/dashboard",
    label: "Дашборд",
    icon: LayoutDashboard,
    status: "live",
    roles: REVENUE_VIEW_ROLES,
    description: "Общий пульс сети: выручка, прибыль, точки, алерты",
  },
  {
    href: "/ai",
    label: "AI-центр",
    icon: Sparkles,
    status: "live",
    description: "Приоритеты, отклонения и сравнение точек — аналитика без LLM (Этап 1)",
  },
  {
    href: "/pos",
    label: "Касса",
    icon: ScanLine,
    status: "live",
    description: "Рабочее место кассира: сканирование, корзина, оплата",
  },
  {
    href: "/sales",
    label: "Продажи",
    icon: TrendingUp,
    status: "live",
    description: "Выручка по точкам, товарам и каналам",
  },
  {
    href: "/production",
    label: "Производство",
    icon: Factory,
    status: "live",
    description: "Рецептуры, производственный план, сменные задания",
  },
  {
    href: "/inventory",
    label: "Склад",
    icon: Package,
    status: "live",
    description: "Остатки, приёмка, списания, инвентаризация",
  },
  {
    href: "/procurement",
    label: "Закупки",
    icon: ShoppingCart,
    status: "live",
    description: "Поставщики, заказы сырья, анализ цен",
  },
  {
    href: "/logistics",
    label: "Логистика",
    icon: Truck,
    status: "live",
    description: "Маршруты доставки, транспорт, статусы",
  },
  {
    href: "/map",
    label: "Карта",
    icon: Map,
    status: "live",
    description: "Точки, склады, маршруты и тепловые карты по городу",
  },
  {
    href: "/finance",
    label: "Финансы",
    icon: Wallet,
    status: "live",
    description: "P&L, себестоимость, маржинальность, расходы",
  },
  {
    href: "/planning",
    label: "Планирование",
    icon: Target,
    status: "live",
    description: "ABC/XYZ, пополнение запасов, план/факт, финансовая модель",
  },
  {
    href: "/hr",
    label: "Персонал",
    icon: Users,
    status: "live",
    description: "Смены, учёт времени, KPI сотрудников",
  },
  {
    href: "/quality",
    label: "Качество и списания",
    icon: AlertTriangle,
    status: "live",
    description: "Учёт брака и списаний по причинам",
  },
  {
    href: "/customers",
    label: "Клиенты",
    icon: Handshake,
    status: "live",
    description: "Оптовые клиенты, лояльность, задолженности",
  },
  {
    href: "/crm",
    label: "CRM",
    icon: HeartHandshake,
    status: "live",
    roles: CRM_ROLES,
    description: "Кому написать сегодня, карточки клиентов, группы, торты на заказ",
  },
  {
    href: "/network",
    label: "Сеть точек",
    icon: Store,
    status: "live",
    description: "Реестр точек, франшиза, сравнение локаций",
  },
  {
    href: "/reports",
    label: "Отчёты",
    icon: BarChart3,
    status: "live",
    roles: REVENUE_VIEW_ROLES,
    description: "Библиотека готовых отчётов: финансы, продажи, качество, персонал, склад",
  },
];

export const secondaryNav: NavItem[] = [
  {
    href: "/integrations",
    label: "Интеграции",
    icon: Plug,
    status: "soon",
    description: "UMAG, iiko, 1С, REST API, CSV, вебхуки",
  },
  {
    href: "/notifications",
    label: "Уведомления",
    icon: Bell,
    status: "live",
    description: "Лента алертов: остатки, долги, просроченные документы",
  },
  {
    href: "/settings",
    label: "Настройки",
    icon: Settings,
    status: "live",
    description: "Сотрудники, роли и доступ к платформе",
  },
];

export const allNavItems = [...primaryNav, ...secondaryNav];

export function canOpen(item: NavItem, role: Role): boolean {
  return !item.roles || item.roles.includes(role);
}

// The page a role lands on after login, or when it opens one it may not see.
export function homeFor(role: Role): string {
  if (role === Role.CASHIER) return "/pos";
  if (role === Role.CLIENT_MANAGER) return "/crm";
  return REVENUE_VIEW_ROLES.includes(role) ? "/dashboard" : "/sales";
}

// A route under a nav item the role may not open (e.g. /reports for OPERATOR).
export function isBlockedRoute(pathname: string, role: Role): boolean {
  return allNavItems.some((item) => !canOpen(item, role) && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
}
