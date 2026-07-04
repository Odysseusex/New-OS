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
  notes: string | null;
  creditLimit: number | null;
  outstandingBalance: number;
}

export interface CreateCustomerRequestDto {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  creditLimit?: number;
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
}
