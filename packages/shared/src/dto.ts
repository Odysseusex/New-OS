import { Role } from "./roles";
import { LocationOwnership, LocationType } from "./location";

export interface LocationDto {
  id: string;
  name: string;
  type: LocationType;
  ownership: LocationOwnership;
  regionId: string | null;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
}

export interface LocationOverviewDto extends LocationDto {
  todayRevenue: number | null;
  lowStockCount: number | null;
}

export interface CreateLocationRequestDto {
  name: string;
  type: LocationType;
  ownership?: LocationOwnership;
  regionId?: string;
  city: string;
  address: string;
  lat?: number;
  lng?: number;
}

export interface UpdateLocationRequestDto {
  name?: string;
  type?: LocationType;
  ownership?: LocationOwnership;
  regionId?: string | null;
  city?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface LocationComparisonDto extends LocationDto {
  revenue: number;
  salesCount: number;
  averageTicket: number;
  lowStockCount: number;
  activeStaffCount: number;
  expenses: number;
}

export interface RegionDto {
  id: string;
  name: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  // The sandbox («Песочница»): a demo company with invented data. Optional so a
  // client one build ahead of the API reads a missing flag as "not a sandbox".
  isDemo?: boolean;
}

export interface CurrentUserDto {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  // Optional custom label shown instead of the role name in the topbar —
  // purely cosmetic, never affects permissions (those come from role).
  title: string | null;
  organizationId: string;
  organization: OrganizationDto;
  locationId: string | null;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface LoginResponseDto {
  accessToken: string;
  user: CurrentUserDto;
}

export interface UserAccountDto {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  title: string | null;
  locationId: string | null;
  locationName: string | null;
  isActive: boolean;
  // A till PIN is set (the PIN itself is never sent back).
  hasPin: boolean;
}

export interface CreateUserAccountRequestDto {
  fullName: string;
  email: string;
  password: string;
  role: Role;
  title?: string;
  locationId?: string;
}

export interface UpdateUserAccountRequestDto {
  fullName?: string;
  email?: string;
  role?: Role;
  title?: string | null;
  locationId?: string | null;
  password?: string;
}

export interface DashboardSummaryDto {
  organizationName: string;
  locationsCount: number;
  regionsCount: number;
  usersCount: number;
  locations: LocationDto[];
  todayRevenue: number;
  last7DaysRevenue: number;
  lowStockCount: number;
  // Дебиторская задолженность and the overdue part of it; null for a role
  // that does not see debts. Optional for a client one build ahead of the API.
  receivables?: { total: number; overdue: number } | null;
}

// The money side of the dashboard (ТЗ §8.4), FINANCE_VIEW_ROLES only.
export interface DashboardPeriodFiguresDto {
  netRevenue: number;
  grossProfit: number;
  grossMarginPercent: number | null;
}

export interface DashboardTopProductDto {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  grossProfit: number;
  marginPercent: number | null;
}

export interface DashboardFinanceDto {
  locationId: string | null;
  today: DashboardPeriodFiguresDto;
  // The last 7 days including today.
  week: DashboardPeriodFiguresDto;
  // The calendar month so far (Almaty).
  month: DashboardPeriodFiguresDto;
  // Balances of the active accounts (with a point chosen: the accounts tied to it).
  cashTotal: number;
  cashAccounts: { id: string; name: string; balance: number }[];
  // Network-wide: debts are kept per counterparty, not per point.
  payables: { total: number; overdue: number };
  receivables: { total: number; overdue: number };
  // Finished goods on the shelves of the shops (STORE points, or the chosen point).
  finishedGoods: { atCost: number; atSalePrice: number; unknownCostItems: number };
  // This month, by revenue.
  topProducts: DashboardTopProductDto[];
}
