import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ShelfCountStatus as PrismaStatus } from "@prisma/client";
import {
  AddShelfCountEntryRequestDto,
  RECONCILIATION_ROLES,
  Role,
  ShelfCountDto,
  ShelfCountEntryKind,
  ShelfCountStatus,
  ShelfCountStatusDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { round3 } from "../common/money";
import { requireLocationScope } from "../common/location-scope";
import { businessDateOf, ReconciliationService } from "./reconciliation.service";

// «Пересчёт» on the cashiers' phones (owner, 27.11.2026): the count used to be written on a printed
// sheet and typed into «Сверка дня» afterwards. Now a point's shared phone login types it in directly —
// several phones at once, amounts adding up per product — and «Отправить» puts the totals into the
// day's «Сверка дня». It is BLIND (nothing here says what the books hold) and it moves nothing: stock
// changes only when a manager presses «Применить к остаткам» there, as before.
@Injectable()
export class ShelfCountService {
  constructor(
    private prisma: PrismaService,
    private reconciliation: ReconciliationService,
  ) {}

  // The point is the login's own; the day is today on the Almaty clock.
  private scope(user: AuthenticatedUser): { locationId: string; date: string } {
    if (user.role !== Role.SHELF_COUNTER) throw new ForbiddenException("Пересчёт с телефона ведут под входом «Пересчёт остатков»");
    if (!user.locationId) throw new ForbiddenException("Этот вход не привязан к точке — укажите точку в карточке сотрудника");
    return { locationId: user.locationId, date: businessDateOf(new Date()) };
  }

  private async sheet(db: PrismaService | Prisma.TransactionClient, organizationId: string, locationId: string, date: string) {
    return db.shelfCount.upsert({
      where: { organizationId_locationId_businessDate: { organizationId, locationId, businessDate: date } },
      create: { organizationId, locationId, businessDate: date },
      update: {},
    });
  }

  async get(user: AuthenticatedUser): Promise<ShelfCountDto> {
    const { locationId, date } = this.scope(user);
    // The same list «Сверка дня» shows and prints — with every figure of the books left out.
    const day = await this.reconciliation.get(user, locationId, date);
    const sheet = await this.sheet(this.prisma, user.organizationId, locationId, date);
    const entries = await this.prisma.shelfCountEntry.findMany({ where: { countId: sheet.id }, orderBy: { createdAt: "asc" } });
    return {
      locationId,
      locationName: day.locationName,
      date,
      status: sheet.status as ShelfCountStatus,
      sentAt: sheet.sentAt?.toISOString() ?? null,
      applied: day.appliedAt !== null,
      products: day.lines.map((l) => ({ productId: l.productId, name: l.productName, sku: l.sku, unit: l.unit, categoryName: l.categoryName })),
      entries: entries.map((e) => ({
        clientId: e.clientId,
        productId: e.productId,
        quantity: e.quantity.toNumber(),
        kind: e.kind as ShelfCountEntryKind,
        deviceId: e.deviceId,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  // One typed amount. Sent again after a bad signal (same clientId) it changes nothing.
  async addEntry(user: AuthenticatedUser, dto: AddShelfCountEntryRequestDto): Promise<{ saved: true }> {
    const { locationId, date } = this.scope(user);
    if (dto.kind !== "ADD" && dto.kind !== "SET") throw new BadRequestException("Неизвестное действие");
    const quantity = round3(dto.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 100_000) throw new BadRequestException("Проверьте количество");
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, organizationId: user.organizationId }, select: { id: true } });
    if (!product) throw new NotFoundException("Товар не найден");
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.sheet(tx, user.organizationId, locationId, date);
      // Two phones typing the same product at once: one at a time, so a «Исправить» sees the true total.
      await tx.$queryRaw`SELECT id FROM shelf_counts WHERE id = ${sheet.id} FOR UPDATE`;
      const locked = await tx.shelfCount.findUniqueOrThrow({ where: { id: sheet.id } });
      if (await tx.shelfCountEntry.findUnique({ where: { countId_clientId: { countId: sheet.id, clientId: dto.clientId } } })) return;
      if (locked.status !== PrismaStatus.OPEN) throw new BadRequestException("Пересчёт уже отправлен — изменить его может только управляющий");
      let delta = quantity;
      if (dto.kind === "SET") {
        const sum = await tx.shelfCountEntry.aggregate({ where: { countId: sheet.id, productId: dto.productId }, _sum: { quantity: true } });
        delta = round3(quantity - (sum._sum.quantity?.toNumber() ?? 0));
      }
      await tx.shelfCountEntry.create({
        data: { countId: sheet.id, productId: dto.productId, quantity: delta, kind: dto.kind, clientId: dto.clientId.slice(0, 80), deviceId: dto.deviceId.slice(0, 80) },
      });
    });
    return { saved: true };
  }

  // The totals go into the day's «Сверка дня» (its money figures and any product the phones did not
  // touch stay as they are); the sheet is locked.
  async send(user: AuthenticatedUser): Promise<ShelfCountDto> {
    const { locationId, date } = this.scope(user);
    const sheet = await this.sheet(this.prisma, user.organizationId, locationId, date);
    if (sheet.status !== PrismaStatus.OPEN) throw new BadRequestException("Пересчёт уже отправлен");
    const totals = await this.totals(sheet.id);
    if (totals.size === 0) throw new BadRequestException("Ещё ничего не посчитано");
    const day = await this.reconciliation.get(user, locationId, date);
    if (day.appliedAt) throw new BadRequestException("Остатки за этот день уже проведены — пересчёт закрыт");
    const lines = new Map(day.lines.filter((l) => l.countedQuantity !== null).map((l) => [l.productId, l.countedQuantity as number]));
    for (const [productId, quantity] of totals) lines.set(productId, Math.max(0, quantity));
    const claimed = await this.prisma.shelfCount.updateMany({ where: { id: sheet.id, status: PrismaStatus.OPEN }, data: { status: PrismaStatus.SENT, sentAt: new Date() } });
    if (claimed.count !== 1) throw new BadRequestException("Пересчёт уже отправлен");
    try {
      await this.reconciliation.save(user, {
        locationId,
        date,
        openingCash: day.openingCash,
        countedCash: day.countedCash,
        countedCard: day.countedCard,
        countedTransfer: day.countedTransfer,
        note: day.note,
        lines: [...lines].map(([productId, countedQuantity]) => ({ productId, countedQuantity })),
      });
    } catch (err) {
      await this.prisma.shelfCount.updateMany({ where: { id: sheet.id }, data: { status: PrismaStatus.OPEN, sentAt: null } });
      throw err;
    }
    return this.get(user);
  }

  private async totals(countId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.shelfCountEntry.groupBy({ by: ["productId"], where: { countId }, _sum: { quantity: true } });
    return new Map(rows.map((r) => [r.productId, round3(r._sum.quantity?.toNumber() ?? 0)]));
  }

  // ── For «Сверка дня» ──

  async status(user: AuthenticatedUser, requestedLocationId: string | undefined, date: string): Promise<ShelfCountStatusDto> {
    const locationId = requireLocationScope(user, requestedLocationId);
    const sheet = await this.prisma.shelfCount.findUnique({
      where: { organizationId_locationId_businessDate: { organizationId: user.organizationId, locationId, businessDate: date } },
      include: { entries: { select: { productId: true, deviceId: true, createdAt: true } } },
    });
    if (!sheet || sheet.entries.length === 0) return { status: null, sentAt: null, countedProducts: 0, devices: 0, lastEntryAt: null };
    return {
      status: sheet.status as ShelfCountStatus,
      sentAt: sheet.sentAt?.toISOString() ?? null,
      countedProducts: new Set(sheet.entries.map((e) => e.productId)).size,
      devices: new Set(sheet.entries.map((e) => e.deviceId)).size,
      lastEntryAt: sheet.entries.reduce((m, e) => (e.createdAt > m ? e.createdAt : m), sheet.entries[0].createdAt).toISOString(),
    };
  }

  // «Вернуть на пересчёт»: the cashiers may go on counting; what they send next replaces their figures.
  async reopen(user: AuthenticatedUser, requestedLocationId: string | undefined, date: string): Promise<ShelfCountStatusDto> {
    if (!RECONCILIATION_ROLES.includes(user.role)) throw new ForbiddenException("Недостаточно прав");
    const locationId = requireLocationScope(user, requestedLocationId);
    const sheet = await this.prisma.shelfCount.findUnique({
      where: { organizationId_locationId_businessDate: { organizationId: user.organizationId, locationId, businessDate: date } },
    });
    if (!sheet || sheet.status !== PrismaStatus.SENT) throw new BadRequestException("Пересчёт за этот день не отправлен");
    if (date !== businessDateOf(new Date())) throw new BadRequestException("Вернуть на пересчёт можно только сегодняшний день");
    await this.prisma.$transaction(async (tx) => {
      await tx.shelfCount.update({ where: { id: sheet.id }, data: { status: PrismaStatus.OPEN, sentAt: null } });
      await recordAudit(tx, { organizationId: user.organizationId, actorId: user.id, action: "shelfCount.reopen", entityType: "ShelfCount", entityId: sheet.id, after: { date, locationId } });
    });
    return this.status(user, locationId, date);
  }
}
