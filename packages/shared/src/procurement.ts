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
  // БИН/ИИН and the deferral the supplier gives us (null = due on delivery).
  bin: string | null;
  paymentTermDays: number | null;
  isActive: boolean;
}

export interface CreateSupplierRequestDto {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  bin?: string | null;
  paymentTermDays?: number | null;
}

export interface UpdateSupplierRequestDto {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  bin?: string | null;
  paymentTermDays?: number | null;
}

export interface PurchaseOrderItemDto {
  id: string;
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
  unitCost: number;
  subtotal: number;
  // Delivered quantity/cost when they differ from the order (null = as ordered).
  receivedQuantity: number | null;
  receivedUnitCost: number | null;
  // Already handed back to the supplier (SupplierReturn), in the line's unit.
  returnedQuantity: number;
}

export interface PurchaseOrderPaymentDto {
  id: string;
  accountId: string;
  accountName: string;
  amount: number;
  paidAt: string;
  note: string | null;
  createdByName: string;
  // A reversed payment stays in the history; it just no longer counts as paid.
  reversedAt: string | null;
  reversalReason: string | null;
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
  // What was actually delivered, valued at delivered costs (null until received).
  receivedTotal: number | null;
  // True when this order created a payable: received on/after the purchasing
  // cutover. An order does NOT owe anything when placed, and an order received
  // before the cutover is legacy (settled outside the system).
  payableRecognized: boolean;
  amountPaid: number;
  balanceDue: number;
  // Paid ahead of the goods: on a PLACED order, everything paid; on a received
  // one, what was paid above the delivery (the supplier owes it back in goods or money).
  advance: number;
  paymentStatus: PaymentStatus | null;
  payments: PurchaseOrderPaymentDto[];
  // How many times the received document was corrected (0 = never).
  revisionCount: number;
  // Goods handed back to the supplier: what they were worth (the debt shrinks
  // by it) and the money the supplier gave back for them.
  returnedTotal: number;
  refundedTotal: number;
  returnCount: number;
}

export interface SupplierReturnItemRequestDto {
  itemId: string;
  quantity: number;
}

// «Возврат поставщику» on a received order. The goods leave the shelf at the
// price they were received at. When the order is already paid for more than it
// is now worth, the supplier hands the difference back to `refundAccountId`.
export interface SupplierReturnRequestDto {
  items: SupplierReturnItemRequestDto[];
  reason: string;
  refundAccountId?: string;
}

// Optional actuals recorded at receipt; anything omitted is received as ordered.
export interface ReceivePurchaseOrderItemRequestDto {
  itemId: string;
  quantity?: number;
  unitCost?: number;
}

export interface ReceivePurchaseOrderRequestDto {
  items?: ReceivePurchaseOrderItemRequestDto[];
}

export interface RecordPurchaseOrderPaymentRequestDto {
  accountId: string;
  amount: number;
  note?: string;
}

// Correcting a RECEIVED order inside the document: the delivered quantity and
// price of each line as they should have been. Lines left out stay as they are.
export interface RevisePurchaseOrderItemRequestDto {
  itemId: string;
  quantity: number;
  unitCost: number;
}

export interface RevisePurchaseOrderRequestDto {
  items: RevisePurchaseOrderItemRequestDto[];
  reason: string;
}

export const PURCHASE_REVISION_REASON_MIN = 5;

export enum DocumentHistoryKind {
  CREATED = "CREATED",
  RECEIVED = "RECEIVED",
  REVISED = "REVISED",
  CANCELLED = "CANCELLED",
  PAID = "PAID",
  PAYMENT_REVERSED = "PAYMENT_REVERSED",
  SUPPLIER_RETURN = "SUPPLIER_RETURN",
}

export const DOCUMENT_HISTORY_LABELS_RU: Record<DocumentHistoryKind, string> = {
  [DocumentHistoryKind.CREATED]: "Заказ создан",
  [DocumentHistoryKind.RECEIVED]: "Принят на склад",
  [DocumentHistoryKind.REVISED]: "Исправлен",
  [DocumentHistoryKind.CANCELLED]: "Отменён",
  [DocumentHistoryKind.PAID]: "Оплата",
  [DocumentHistoryKind.PAYMENT_REVERSED]: "Оплата отменена",
  [DocumentHistoryKind.SUPPLIER_RETURN]: "Возврат поставщику",
};

export interface DocumentHistoryLineDto {
  productName: string;
  unit: string;
  quantityBefore: number;
  quantityAfter: number;
  unitCostBefore: number;
  unitCostAfter: number;
}

// One row of «История изменений»: who, when, what the document said before and after.
export interface DocumentHistoryEntryDto {
  kind: DocumentHistoryKind;
  at: string;
  actorName: string | null;
  // The document's amount before and after the change (receipt, correction).
  amountBefore: number | null;
  amountAfter: number | null;
  // A payment or its reversal; for a return, the money the supplier gave back.
  amount: number | null;
  reason: string | null;
  lines: DocumentHistoryLineDto[];
}

export interface ReversePurchaseOrderPaymentRequestDto {
  reason: string;
}

export interface PurchaseWorkflowDto {
  // Null = purchasing cutover not activated (old behaviour).
  cutoverAt: string | null;
  activated: boolean;
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
