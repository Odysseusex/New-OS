import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CRM_ORDER_DONE_VISIBLE_DAYS, CrmOrderDto, CrmOrderStage, SaveCrmOrderRequestDto } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { startOfZonedDay } from "../common/zoned-day";
import { PrismaService } from "../prisma/prisma.service";

export const ORDER_INCLUDE = { events: { orderBy: { at: "asc" as const } } };

type OrderRow = Prisma.CrmOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export function toOrderDto(o: OrderRow): CrmOrderDto {
  return {
    id: o.id,
    number: o.number,
    memberId: o.memberId,
    customerName: o.customerName,
    phone: o.phone,
    title: o.title,
    details: o.details,
    weightKg: o.weightKg?.toNumber() ?? null,
    price: o.price?.toNumber() ?? null,
    prepaid: o.prepaid,
    dueAt: o.dueAt.toISOString(),
    stage: o.stage as CrmOrderStage,
    stageChangedAt: o.stageChangedAt.toISOString(),
    cancelReason: o.cancelReason,
    createdByName: o.createdByName,
    createdAt: o.createdAt.toISOString(),
    events: o.events.map((e) => ({ fromStage: (e.fromStage as CrmOrderStage | null) ?? null, toStage: e.toStage as CrmOrderStage, byName: e.byName, at: e.at.toISOString() })),
  };
}

const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
const DAY = 86_400_000;

// Custom orders: a board of cards with a due date. Nothing here touches money
// or stock — the price is what was agreed, payment goes through the till.
@Injectable()
export class CrmOrdersService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string, now = new Date()): Promise<CrmOrderDto[]> {
    const doneSince = new Date(startOfZonedDay(now).getTime() - CRM_ORDER_DONE_VISIBLE_DAYS * DAY);
    const rows = await this.prisma.crmOrder.findMany({
      where: {
        organizationId,
        OR: [{ stage: { notIn: [CrmOrderStage.DONE, CrmOrderStage.CANCELLED] } }, { stageChangedAt: { gte: doneSince } }],
      },
      include: ORDER_INCLUDE,
      orderBy: [{ dueAt: "asc" }, { number: "asc" }],
      take: 500,
    });
    return rows.map(toOrderDto);
  }

  async create(user: AuthenticatedUser, dto: SaveCrmOrderRequestDto): Promise<CrmOrderDto> {
    const member = dto.memberId
      ? await this.prisma.loyaltyMember.findFirst({ where: { id: dto.memberId, organizationId: user.organizationId }, select: { id: true, name: true, phone: true } })
      : null;
    if (dto.memberId && !member) throw new NotFoundException("Клиент не найден");
    const customerName = blank(dto.customerName) ?? member?.name ?? member?.phone ?? null;
    const title = blank(dto.title);
    if (!customerName) throw new BadRequestException("Укажите имя заказчика");
    if (!title) throw new BadRequestException("Укажите, что заказали");
    const dueAt = this.parseDue(dto.dueAt);
    const stage = dto.stage ?? CrmOrderStage.NEW;

    // The number is the next one in the organization; a concurrent order taking
    // it first makes the unique index refuse, and we simply take the next.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          const last = await tx.crmOrder.findFirst({ where: { organizationId: user.organizationId }, orderBy: { number: "desc" }, select: { number: true } });
          return tx.crmOrder.create({
            data: {
              organizationId: user.organizationId,
              number: (last?.number ?? 0) + 1,
              memberId: member?.id ?? null,
              customerName,
              phone: blank(dto.phone) ?? member?.phone ?? null,
              title,
              details: blank(dto.details) ?? null,
              weightKg: this.positive(dto.weightKg, "Вес"),
              price: this.positive(dto.price, "Цена", 2),
              prepaid: dto.prepaid ?? false,
              dueAt,
              stage,
              createdById: user.id,
              createdByName: user.fullName,
              events: { create: { fromStage: null, toStage: stage, byName: user.fullName } },
            },
            include: ORDER_INCLUDE,
          });
        });
        return toOrderDto(row);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    throw new BadRequestException("Не удалось присвоить номер заказу, попробуйте ещё раз");
  }

  async update(user: AuthenticatedUser, id: string, dto: SaveCrmOrderRequestDto): Promise<CrmOrderDto> {
    const order = await this.prisma.crmOrder.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!order) throw new NotFoundException("Заказ не найден");
    if (dto.memberId) {
      const m = await this.prisma.loyaltyMember.findFirst({ where: { id: dto.memberId, organizationId: user.organizationId }, select: { id: true } });
      if (!m) throw new NotFoundException("Клиент не найден");
    }
    const data: Prisma.CrmOrderUncheckedUpdateInput = {};
    if (dto.memberId !== undefined) data.memberId = dto.memberId || null;
    if (dto.customerName !== undefined) {
      const name = blank(dto.customerName);
      if (!name) throw new BadRequestException("Укажите имя заказчика");
      data.customerName = name;
    }
    if (dto.title !== undefined) {
      const title = blank(dto.title);
      if (!title) throw new BadRequestException("Укажите, что заказали");
      data.title = title;
    }
    if (dto.phone !== undefined) data.phone = blank(dto.phone);
    if (dto.details !== undefined) data.details = blank(dto.details);
    if (dto.weightKg !== undefined) data.weightKg = this.positive(dto.weightKg, "Вес");
    if (dto.price !== undefined) data.price = this.positive(dto.price, "Цена", 2);
    if (dto.prepaid !== undefined) data.prepaid = dto.prepaid;
    if (dto.dueAt !== undefined) data.dueAt = this.parseDue(dto.dueAt);
    const stageChanged = dto.stage !== undefined && dto.stage !== order.stage;
    if (stageChanged) {
      data.stage = dto.stage;
      data.stageChangedAt = new Date();
      data.cancelReason = dto.stage === CrmOrderStage.CANCELLED ? blank(dto.cancelReason) ?? null : null;
      // Reaching «Предоплата» means the prepayment was taken at the till.
      if (dto.stage === CrmOrderStage.PREPAID && dto.prepaid === undefined) data.prepaid = true;
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (stageChanged) await tx.crmOrderEvent.create({ data: { orderId: id, fromStage: order.stage, toStage: dto.stage!, byName: user.fullName } });
      return tx.crmOrder.update({ where: { id }, data, include: ORDER_INCLUDE });
    });
    return toOrderDto(row);
  }

  private parseDue(value: string | undefined): Date {
    const at = value ? new Date(value) : null;
    if (!at || Number.isNaN(at.getTime())) throw new BadRequestException("Укажите дату выдачи");
    return at;
  }

  private positive(value: number | null | undefined, label: string, decimals = 3): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException(`${label}: значение должно быть больше нуля`);
    const scale = 10 ** decimals;
    return Math.round(value * scale) / scale;
  }
}
