import { Unit } from "./catalog";

export enum VehicleStatus {
  AVAILABLE = "AVAILABLE",
  ON_ROUTE = "ON_ROUTE",
  MAINTENANCE = "MAINTENANCE",
}

export const VEHICLE_STATUS_LABELS_RU: Record<VehicleStatus, string> = {
  [VehicleStatus.AVAILABLE]: "Свободен",
  [VehicleStatus.ON_ROUTE]: "На маршруте",
  [VehicleStatus.MAINTENANCE]: "На ремонте",
};

export enum DeliveryRouteStatus {
  PLANNED = "PLANNED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export const DELIVERY_ROUTE_STATUS_LABELS_RU: Record<DeliveryRouteStatus, string> = {
  [DeliveryRouteStatus.PLANNED]: "Запланирован",
  [DeliveryRouteStatus.IN_PROGRESS]: "В пути",
  [DeliveryRouteStatus.COMPLETED]: "Завершён",
  [DeliveryRouteStatus.CANCELLED]: "Отменён",
};

export enum RouteStopStatus {
  PENDING = "PENDING",
  DELIVERED = "DELIVERED",
}

export const ROUTE_STOP_STATUS_LABELS_RU: Record<RouteStopStatus, string> = {
  [RouteStopStatus.PENDING]: "Ожидает",
  [RouteStopStatus.DELIVERED]: "Доставлено",
};

export interface VehicleDto {
  id: string;
  name: string;
  plateNumber: string;
  status: VehicleStatus;
  isActive: boolean;
}

export interface CreateVehicleRequestDto {
  name: string;
  plateNumber: string;
}

export interface UpdateVehicleRequestDto {
  name?: string;
  plateNumber?: string;
  status?: VehicleStatus;
}

export interface DriverDto {
  id: string;
  fullName: string;
}

export interface RouteStopItemDto {
  id: string;
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
}

export interface RouteStopDto {
  id: string;
  destinationLocationId: string;
  destinationLocationName: string;
  sequence: number;
  status: RouteStopStatus;
  deliveredAt: string | null;
  items: RouteStopItemDto[];
}

export interface DeliveryRouteDto {
  id: string;
  originLocationId: string;
  originLocationName: string;
  vehicleId: string | null;
  vehicleName: string | null;
  driverId: string | null;
  driverName: string | null;
  status: DeliveryRouteStatus;
  scheduledFor: string;
  createdByName: string;
  stops: RouteStopDto[];
}

export interface CreateRouteStopItemRequestDto {
  productId: string;
  quantity: number;
}

export interface CreateRouteStopRequestDto {
  destinationLocationId: string;
  items: CreateRouteStopItemRequestDto[];
}

export interface CreateDeliveryRouteRequestDto {
  originLocationId?: string;
  vehicleId?: string;
  driverId?: string;
  scheduledFor?: string;
  stops: CreateRouteStopRequestDto[];
}
