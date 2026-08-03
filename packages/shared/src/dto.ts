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
}
