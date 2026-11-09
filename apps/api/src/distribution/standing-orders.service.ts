import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { SaveStandingOrderRequestDto, STANDING_ORDER_MAX_LINES, StandingOrderLineDto } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { round2, round3 } from "../common/money";

// «Постоянный заказ» of a point or a wholesale customer: what Производство → «Распределение» prefills.
// It is only a template — nothing in the books reads it; the documents are made by the ordinary transfer
// and sale endpoints.
@Injectable()
export class StandingOrdersService {
  constructor(private prisma: PrismaService) {}

  async list(user: AuthenticatedUser): Promise<StandingOrderLineDto[]> {
    const rows = await this.prisma.standingOrderLine.findMany({ where: { organizationId: user.organizationId } });
    return rows.map((r) => ({
      customerId: r.customerId,
      locationId: r.locationId,
      productId: r.productId,
      quantity: r.quantity.toNumber(),
      unitPrice: r.unitPrice?.toNumber() ?? null,
    }));
  }

  // Replaces the target's whole standing order. A line with quantity 0 is kept when it carries a price
  // (the agreed price for something not taken every day), otherwise dropped.
  async save(user: AuthenticatedUser, dto: SaveStandingOrderRequestDto): Promise<StandingOrderLineDto[]> {
    const customerId = dto.customerId || null;
    const locationId = dto.locationId || null;
    if ((customerId === null) === (locationId === null)) throw new BadRequestException("Укажите либо точку, либо оптового клиента");
    const lines = dto.lines ?? [];
    if (lines.length > STANDING_ORDER_MAX_LINES) throw new BadRequestException(`Не больше ${STANDING_ORDER_MAX_LINES} строк`);
    if (new Set(lines.map((l) => l.productId)).size !== lines.length) throw new BadRequestException("Один и тот же товар указан дважды");
    for (const l of lines) {
      if (!(l.quantity >= 0)) throw new BadRequestException("Количество не может быть отрицательным");
      if (l.unitPrice !== undefined && l.unitPrice !== null && !(l.unitPrice >= 0)) throw new BadRequestException("Цена не может быть отрицательной");
    }
    if (locationId && lines.some((l) => l.unitPrice !== undefined && l.unitPrice !== null)) {
      throw new BadRequestException("Цена указывается только для оптового клиента");
    }
    if (customerId) {
      const found = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: user.organizationId }, select: { id: true } });
      if (!found) throw new NotFoundException("Клиент не найден");
    } else {
      const found = await this.prisma.location.findFirst({ where: { id: locationId!, organizationId: user.organizationId }, select: { id: true } });
      if (!found) throw new NotFoundException("Точка не найдена");
    }
    const productIds = lines.map((l) => l.productId);
    const known = await this.prisma.product.count({ where: { organizationId: user.organizationId, id: { in: productIds } } });
    if (known !== productIds.length) throw new NotFoundException("Товар не найден");

    const kept = lines.filter((l) => l.quantity > 0 || (l.unitPrice !== undefined && l.unitPrice !== null));
    const target = customerId ? { customerId } : { locationId };
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.standingOrderLine.findMany({ where: { organizationId: user.organizationId, ...target } });
      await tx.standingOrderLine.deleteMany({ where: { organizationId: user.organizationId, ...target } });
      if (kept.length > 0) {
        await tx.standingOrderLine.createMany({
          data: kept.map((l) => ({
            organizationId: user.organizationId,
            customerId,
            locationId,
            productId: l.productId,
            quantity: round3(l.quantity),
            unitPrice: l.unitPrice === undefined || l.unitPrice === null ? null : round2(l.unitPrice),
          })),
        });
      }
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "standingOrder.update",
        entityType: customerId ? "Customer" : "Location",
        entityId: (customerId ?? locationId)!,
        before: { lines: before.map((b) => ({ productId: b.productId, quantity: b.quantity.toNumber(), unitPrice: b.unitPrice?.toNumber() ?? null })) },
        after: { lines: kept },
      });
    });
    return (await this.list(user)).filter((l) => (customerId ? l.customerId === customerId : l.locationId === locationId));
  }
}
