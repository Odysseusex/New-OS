import { Unit } from "./catalog";
import { PaymentStatus } from "./customers";

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

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  CONFIRMED = "CONFIRMED",
  CANCELLED = "CANCELLED",
}

export const INVOICE_STATUS_LABELS_RU: Record<InvoiceStatus, string> = {
  [InvoiceStatus.DRAFT]: "Черновик",
  [InvoiceStatus.CONFIRMED]: "Проведена",
  [InvoiceStatus.CANCELLED]: "Отменена",
};

// Where an invoice's data came from. MANUAL is the only path today —
// AI_SCAN and API_SYNC are placeholders for a future photo-recognition flow
// and UMAG/1С sync, so the UI already has a place to show the source.
export enum InvoiceSource {
  MANUAL = "MANUAL",
  AI_SCAN = "AI_SCAN",
  API_SYNC = "API_SYNC",
}

export const INVOICE_SOURCE_LABELS_RU: Record<InvoiceSource, string> = {
  [InvoiceSource.MANUAL]: "Вручную",
  [InvoiceSource.AI_SCAN]: "Распознано по фото",
  [InvoiceSource.API_SYNC]: "Синхронизация",
};

export interface InvoiceItemDto {
  id: string;
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
  unitCost: number;
  subtotal: number;
}

export interface InvoiceDto {
  id: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  number: string;
  issuedAt: string;
  status: InvoiceStatus;
  source: InvoiceSource;
  photoUrl: string | null;
  notes: string | null;
  totalCost: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  createdByName: string;
  confirmedAt: string | null;
  items: InvoiceItemDto[];
}

export interface CreateInvoiceItemRequestDto {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface CreateInvoiceRequestDto {
  supplierId: string;
  locationId?: string;
  number: string;
  issuedAt?: string;
  notes?: string;
  items: CreateInvoiceItemRequestDto[];
}
