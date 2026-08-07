export enum PaymentStatus {
  PAID = "PAID",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  UNPAID = "UNPAID",
}

export const PAYMENT_STATUS_LABELS_RU: Record<PaymentStatus, string> = {
  [PaymentStatus.PAID]: "Оплачено",
  [PaymentStatus.PARTIALLY_PAID]: "Частично оплачено",
  [PaymentStatus.UNPAID]: "Не оплачено",
};

export interface CustomerDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  creditLimit: number | null;
  outstandingBalance: number;
  isActive: boolean;
}

export interface CreateCustomerRequestDto {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  creditLimit?: number;
}

export interface UpdateCustomerRequestDto {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string;
  creditLimit?: number | null;
}

export interface CustomerOrderDto {
  saleId: string;
  locationName: string;
  soldAt: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
}

export interface CustomerDetailDto extends CustomerDto {
  orders: CustomerOrderDto[];
}

export interface RecordPaymentRequestDto {
  amount: number;
  // Which account the payment landed in. Falls back to the sale's own
  // paymentMethod-implied account when omitted.
  accountId?: string;
  // Optional free-text note, stored on the CashMovement in place of the
  // default "Погашение долга по продаже" reason.
  reason?: string;
}
