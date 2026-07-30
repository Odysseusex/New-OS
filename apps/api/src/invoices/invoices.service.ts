import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InvoiceDto, InvoiceSource, InvoiceStatus, Unit } from "@bakery-os/shared";
import { InvoiceStatus as PrismaInvoiceStatus, StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";

const INVOICE_INCLUDE = {
  supplier: true,
  location: true,
  createdBy: true,
  items: { include: { product: true } },
};

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, requestedLocationId?: string): Promise<InvoiceDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: INVOICE_INCLUDE,
      orderBy: { issuedAt: "desc" },
      take: 100,
    });

    return invoices.map(this.toDto);
  }

  async create(user: AuthenticatedUser, dto: CreateInvoiceDto): Promise<InvoiceDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId: user.organizationId },
    });
    if (!supplier) {
      throw new NotFoundException("Поставщик не найден");
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: user.organizationId },
    });
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException("Один или несколько товаров не найдены");
    }

    const items = dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      subtotal: item.quantity * item.unitCost,
    }));
    const totalCost = items.reduce((sum, i) => sum + i.subtotal, 0);

    const invoice = await this.prisma.invoice.create({
      data: {
        organizationId: user.organizationId,
        supplierId: dto.supplierId,
        locationId,
        number: dto.number,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        notes: dto.notes,
        source: InvoiceSource.MANUAL,
        totalCost,
        createdById: user.id,
        items: { create: items },
      },
      include: INVOICE_INCLUDE,
    });

    return this.toDto(invoice);
  }

  async confirm(user: AuthenticatedUser, invoiceId: string): Promise<InvoiceDto> {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: user.organizationId },
        include: { items: { include: { product: true } } },
      });
      if (!invoice) {
        throw new NotFoundException("Накладная не найдена");
      }
      resolveLocationScope(user, invoice.locationId);
      if (invoice.status !== PrismaInvoiceStatus.DRAFT) {
        throw new BadRequestException("Накладная уже обработана");
      }

      for (const item of invoice.items) {
        await tx.stockLevel.upsert({
          where: { locationId_productId: { locationId: invoice.locationId, productId: item.productId } },
          update: { quantity: { increment: item.quantity.toNumber() } },
          create: {
            organizationId: user.organizationId,
            locationId: invoice.locationId,
            productId: item.productId,
            quantity: item.quantity.toNumber(),
            minQuantity: item.product.minQuantity,
          },
        });
      }

      await tx.stockMovement.createMany({
        data: invoice.items.map((item) => ({
          organizationId: user.organizationId,
          locationId: invoice.locationId,
          productId: item.productId,
          type: StockMovementType.RECEIPT,
          quantity: item.quantity,
          reason: `Приёмка по накладной №${invoice.number}`,
          invoiceId: invoice.id,
          createdById: user.id,
        })),
      });

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: PrismaInvoiceStatus.CONFIRMED, confirmedAt: new Date() },
        include: INVOICE_INCLUDE,
      });

      return this.toDto(updated);
    });
  }

  async cancel(user: AuthenticatedUser, invoiceId: string): Promise<InvoiceDto> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: user.organizationId },
    });
    if (!invoice) {
      throw new NotFoundException("Накладная не найдена");
    }
    resolveLocationScope(user, invoice.locationId);
    if (invoice.status !== PrismaInvoiceStatus.DRAFT) {
      throw new BadRequestException("Проведённую накладную нельзя отменить — она уже изменила остатки");
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: PrismaInvoiceStatus.CANCELLED },
      include: INVOICE_INCLUDE,
    });

    return this.toDto(updated);
  }

  private toDto = (invoice: {
    id: string;
    supplierId: string;
    supplier: { name: string };
    locationId: string;
    location: { name: string };
    number: string;
    issuedAt: Date;
    status: string;
    source: string;
    photoUrl: string | null;
    notes: string | null;
    totalCost: { toNumber: () => number };
    createdBy: { fullName: string };
    confirmedAt: Date | null;
    items: {
      id: string;
      productId: string;
      product: { name: string; unit: string };
      quantity: { toNumber: () => number };
      unitCost: { toNumber: () => number };
      subtotal: { toNumber: () => number };
    }[];
  }): InvoiceDto => ({
    id: invoice.id,
    supplierId: invoice.supplierId,
    supplierName: invoice.supplier.name,
    locationId: invoice.locationId,
    locationName: invoice.location.name,
    number: invoice.number,
    issuedAt: invoice.issuedAt.toISOString(),
    status: invoice.status as InvoiceStatus,
    source: invoice.source as InvoiceSource,
    photoUrl: invoice.photoUrl,
    notes: invoice.notes,
    totalCost: invoice.totalCost.toNumber(),
    createdByName: invoice.createdBy.fullName,
    confirmedAt: invoice.confirmedAt ? invoice.confirmedAt.toISOString() : null,
    items: invoice.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      unit: item.product.unit as Unit,
      quantity: item.quantity.toNumber(),
      unitCost: item.unitCost.toNumber(),
      subtotal: item.subtotal.toNumber(),
    })),
  });
}
