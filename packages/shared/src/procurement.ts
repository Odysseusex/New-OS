import { Unit } from "./catalog";

export enum PurchaseOrderStatus {
  PLACED = "PLACED",
  RECEIVED = "RECEIVED",
  CANCELLED = "CANCELLED",
}

export const PURCHASE_ORDER_STATUS_LABELS_RU: Record<PurchaseOrderStatus, string> = {
  [PurchaseOrderStatus.PLACED]: "Заказан",
  [PurchaseOrderStatus.RECEIVED]: "Получен",
  [PurchaseOrderStatus.CANCELLED]: "Отменён",
};

export interface SupplierDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface CreateSupplierRequestDto {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface UpdateSupplierRequestDto {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface PurchaseOrderItemDto {
  id: string;
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
  unitCost: number;
  subtotal: number;
}

export interface PurchaseOrderDto {
  id: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  status: PurchaseOrderStatus;
  totalCost: number;
  orderedAt: string;
  receivedAt: string | null;
  createdByName: string;
  items: PurchaseOrderItemDto[];
}

export interface CreatePurchaseOrderItemRequestDto {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface CreatePurchaseOrderRequestDto {
  supplierId: string;
  locationId?: string;
  items: CreatePurchaseOrderItemRequestDto[];
}
