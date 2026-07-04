import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Sparkles,
  TrendingUp,
  Factory,
  Package,
  ShoppingCart,
  Truck,
  Map,
  Wallet,
  Users,
  AlertTriangle,
  Handshake,
  Store,
  BarChart3,
  Plug,
  Bell,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  status: "live" | "soon";
  description: string;
}

export const primaryNav: NavItem[] = [
  {
    href: "/dashboard",
    label: "Дашборд",
    icon: LayoutDashboard,
    status: "live",
    description: "Общий пульс сети: выручка, прибыль, точки, алерты",
  },
  {
    href: "/ai",
    label: "AI-центр",
    icon: Sparkles,
    status: "soon",
    description: "Рекомендации, прогнозы спроса, обнаружение аномалий",
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
    href: "/hr",
    label: "Персонал",
    icon: Users,
    status: "soon",
    description: "Смены, учёт времени, KPI сотрудников",
  },
  {
    href: "/quality",
    label: "Качество и списания",
    icon: AlertTriangle,
    status: "soon",
    description: "Брак, потери, контроль соблюдения рецептур",
  },
  {
    href: "/customers",
    label: "Клиенты",
    icon: Handshake,
    status: "soon",
    description: "Оптовые клиенты, лояльность, задолженности",
  },
  {
    href: "/network",
    label: "Сеть точек",
    icon: Store,
    status: "soon",
    description: "Реестр точек, франшиза, сравнение локаций",
  },
  {
    href: "/reports",
    label: "Отчёты",
    icon: BarChart3,
    status: "soon",
    description: "Конструктор отчётов и готовые шаблоны",
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
    status: "soon",
    description: "Единая лента событий и алертов",
  },
  {
    href: "/settings",
    label: "Настройки",
    icon: Settings,
    status: "soon",
    description: "Пользователи, роли, организация, аудит",
  },
];

export const allNavItems = [...primaryNav, ...secondaryNav];
