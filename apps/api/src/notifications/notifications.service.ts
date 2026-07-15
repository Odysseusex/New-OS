import { Injectable } from "@nestjs/common";
import {
  PurchaseOrderStatus,
  InvoiceStatus,
  ProductionBatchStatus,
} from "@prisma/client";
import {
  NotificationDto,
  NotificationSeverity,
  NotificationType,
  ORG_WIDE_ROLES,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { resolveLocationScope } from "../common/location-scope";
import { InventoryService } from "../inventory/inventory.service";
import { CustomersService } from "../customers/customers.service";

const STALE_PURCHASE_ORDER_DAYS = 3;
const STALE_INVOICE_DAYS = 3;

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
    private customersService: CustomersService,
  ) {}

  async getNotifications(user: AuthenticatedUser): Promise<NotificationDto[]> {
    const locationId = resolveLocationScope(user);
    const isOrgWide = ORG_WIDE_ROLES.includes(user.role);
    const now = new Date();

    const [candidates, dismissals] = await Promise.all([
      this.computeCandidates(user, locationId, isOrgWide, now),
      this.prisma.notificationDismissal.findMany({ where: { userId: user.id } }),
    ]);

    const dismissedKeys = new Set(dismissals.map((d) => d.key));
    return candidates
      .filter((n) => !dismissedKeys.has(n.key))
      .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.createdAt.localeCompare(a.createdAt));
  }

  async dismiss(user: AuthenticatedUser, key: string): Promise<{ dismissed: true }> {
    await this.prisma.notificationDismissal.upsert({
      where: { userId_key: { userId: user.id, key } },
      create: { organizationId: user.organizationId, userId: user.id, key },
      update: {},
    });
    return { dismissed: true };
  }

  async dismissAll(user: AuthenticatedUser): Promise<{ dismissed: true }> {
    const active = await this.getNotifications(user);
    if (active.length > 0) {
      await this.prisma.notificationDismissal.createMany({
        data: active.map((n) => ({ organizationId: user.organizationId, userId: user.id, key: n.key })),
        skipDuplicates: true,
      });
    }
    return { dismissed: true };
  }

  private async computeCandidates(
    user: AuthenticatedUser,
    locationId: string | undefined,
    isOrgWide: boolean,
    now: Date,
  ): Promise<NotificationDto[]> {
    const staleInvoiceCutoff = new Date(now.getTime() - STALE_INVOICE_DAYS * 24 * 60 * 60 * 1000);
    const stalePurchaseOrderCutoff = new Date(now.getTime() - STALE_PURCHASE_ORDER_DAYS * 24 * 60 * 60 * 1000);

    const [stockLevels, staleInvoices, stalePurchaseOrders, overdueBatches, customers] = await Promise.all([
      this.inventoryService.getStockLevels(user),
      this.prisma.invoice.findMany({
        where: {
          organizationId: user.organizationId,
          status: InvoiceStatus.DRAFT,
          issuedAt: { lte: staleInvoiceCutoff },
          ...(locationId ? { locationId } : {}),
        },
        include: { supplier: true, location: true },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          organizationId: user.organizationId,
          status: PurchaseOrderStatus.PLACED,
          orderedAt: { lte: stalePurchaseOrderCutoff },
          ...(locationId ? { locationId } : {}),
        },
        include: { supplier: true, location: true },
      }),
      this.prisma.productionBatch.findMany({
        where: {
          organizationId: user.organizationId,
          status: ProductionBatchStatus.PLANNED,
          scheduledFor: { lte: now },
          ...(locationId ? { locationId } : {}),
        },
        include: { recipe: { include: { product: true } }, location: true },
      }),
      isOrgWide ? this.customersService.findAllForOrganization(user.organizationId) : Promise.resolve([]),
    ]);

    const notifications: NotificationDto[] = [];
    // Every key ends with today's date so a dismissal only means "seen
    // today" — if the underlying condition is still true tomorrow, it
    // resurfaces instead of staying hidden forever.
    const today = now.toISOString().slice(0, 10);

    for (const level of stockLevels) {
      if (!level.isLow) continue;
      notifications.push({
        key: `low-stock:${level.id}:${today}`,
        type: NotificationType.LOW_STOCK,
        severity: NotificationSeverity.WARNING,
        title: "Низкий остаток",
        message: `«${level.productName}» на точке «${level.locationName}»: ${level.quantity} из мин. ${level.minQuantity}`,
        locationId: level.locationId,
        locationName: level.locationName,
        link: "/inventory",
        createdAt: now.toISOString(),
      });
    }

    for (const customer of customers) {
      if (!customer.creditLimit || customer.outstandingBalance <= customer.creditLimit) continue;
      notifications.push({
        key: `customer-over-limit:${customer.id}:${today}`,
        type: NotificationType.CUSTOMER_OVER_LIMIT,
        severity: NotificationSeverity.CRITICAL,
        title: "Клиент превысил лимит долга",
        message: `«${customer.name}»: долг ${Math.round(customer.outstandingBalance)} при лимите ${Math.round(customer.creditLimit)}`,
        locationId: null,
        locationName: null,
        link: "/customers",
        createdAt: now.toISOString(),
      });
    }

    for (const po of stalePurchaseOrders) {
      const daysAgo = Math.floor((now.getTime() - po.orderedAt.getTime()) / (24 * 60 * 60 * 1000));
      notifications.push({
        key: `stale-po:${po.id}:${today}`,
        type: NotificationType.STALE_PURCHASE_ORDER,
        severity: NotificationSeverity.WARNING,
        title: "Заказ поставщику долго не получен",
        message: `Заказ у «${po.supplier.name}» на точке «${po.location.name}» размещён ${daysAgo} дн. назад и всё ещё не получен`,
        locationId: po.locationId,
        locationName: po.location.name,
        link: "/procurement",
        createdAt: po.orderedAt.toISOString(),
      });
    }

    for (const invoice of staleInvoices) {
      const daysAgo = Math.floor((now.getTime() - invoice.issuedAt.getTime()) / (24 * 60 * 60 * 1000));
      notifications.push({
        key: `stale-invoice:${invoice.id}:${today}`,
        type: NotificationType.STALE_INVOICE,
        severity: NotificationSeverity.WARNING,
        title: "Накладная не подтверждена",
        message: `Накладная №${invoice.number} от «${invoice.supplier.name}» на точке «${invoice.location.name}» создана ${daysAgo} дн. назад и всё ещё черновик`,
        locationId: invoice.locationId,
        locationName: invoice.location.name,
        link: "/procurement",
        createdAt: invoice.issuedAt.toISOString(),
      });
    }

    for (const batch of overdueBatches) {
      notifications.push({
        key: `overdue-batch:${batch.id}:${today}`,
        type: NotificationType.OVERDUE_PRODUCTION_BATCH,
        severity: NotificationSeverity.WARNING,
        title: "Партия просрочена",
        message: `Партия «${batch.recipe.product.name}» на точке «${batch.location.name}» должна была начаться ${batch.scheduledFor.toLocaleString("ru-RU")}, но всё ещё не запущена`,
        locationId: batch.locationId,
        locationName: batch.location.name,
        link: "/production",
        createdAt: batch.scheduledFor.toISOString(),
      });
    }

    return notifications;
  }
}

function severityWeight(severity: NotificationSeverity): number {
  switch (severity) {
    case NotificationSeverity.CRITICAL:
      return 2;
    case NotificationSeverity.WARNING:
      return 1;
    default:
      return 0;
  }
}
