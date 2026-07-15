export enum NotificationType {
  LOW_STOCK = "LOW_STOCK",
  CUSTOMER_OVER_LIMIT = "CUSTOMER_OVER_LIMIT",
  STALE_PURCHASE_ORDER = "STALE_PURCHASE_ORDER",
  STALE_INVOICE = "STALE_INVOICE",
  OVERDUE_PRODUCTION_BATCH = "OVERDUE_PRODUCTION_BATCH",
}

export enum NotificationSeverity {
  INFO = "INFO",
  WARNING = "WARNING",
  CRITICAL = "CRITICAL",
}

export const NOTIFICATION_SEVERITY_LABELS_RU: Record<NotificationSeverity, string> = {
  [NotificationSeverity.INFO]: "Информация",
  [NotificationSeverity.WARNING]: "Внимание",
  [NotificationSeverity.CRITICAL]: "Критично",
};

export interface NotificationDto {
  key: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  locationId: string | null;
  locationName: string | null;
  link: string;
  createdAt: string;
}
