import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CashMovementType,
  DailyReconciliationDto,
  PaymentMethod,
  ReconciliationHistoryItemDto,
  ReconciliationMoneyDto,
  ReconciliationStockLineDto,
  ReconciliationTillMovementDto,
  summarizeReconciliation,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { BUSINESS_TIME_ZONE, startOfZonedDay } from "../common/zoned-day";
import { cashEffectOf, stockEffectOf } from "../common/ledger-effects";
import { allocateRefund } from "../sales/refund-allocation";
import { SaveDailyReconciliationDto } from "./dto/reconciliation.dto";

// «Сверка дня»: the expected side is ALWAYS recomputed from the ledgers
// (StockMovement for the shelf, sales/returns/till movements for the money); only
// what was counted is stored. Saving moves no stock and no money.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
export const businessDateOf = (at: Date): string => dateKeyFormat.format(at);

// The instants a business day covers: [start, end).
export function businessDayRange(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    throw new BadRequestException("Дата должна быть в формате ГГГГ-ММ-ДД");
  }
  // Noon UTC is the afternoon of the same calendar day in Almaty.
  const noon = new Date(`${date}T12:00:00Z`);
  if (businessDateOf(noon) !== date) throw new BadRequestException("Неверная дата");
  return { start: startOfZonedDay(noon), end: startOfZonedDay(new Date(noon.getTime() + 24 * 3600 * 1000)) };
}

const RECEIVED = new Set(["RECEIPT", "TRANSFER_IN", "PRODUCTION_OUTPUT"]);
// Money the worksheet takes from the sales and returns themselves, so the till's
// own rows for them are not counted twice; an opening balance is set-up, not trade.
const TILL_SKIPPED = new Set<string>([CashMovementType.SALE_RECEIPT, CashMovementType.SALE_REFUND, CashMovementType.OPENING_BALANCE]);

@Injectable()
export class ReconciliationService {
  constructor(private prisma: PrismaService) {}

  async get(user: AuthenticatedUser, requestedLocationId: string | undefined, date: string): Promise<DailyReconciliationDto> {
    const locationId = requireLocationScope(user, requestedLocationId);
    const { start, end } = businessDayRange(date);
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId: user.organizationId }, select: { name: true } });
    if (!location) throw new NotFoundException("Точка не найдена");

    const [saved, lines, money] = await Promise.all([
      this.prisma.dailyReconciliation.findUnique({
        where: { organizationId_locationId_businessDate: { organizationId: user.organizationId, locationId, businessDate: date } },
        include: { lines: true, savedBy: { select: { fullName: true } } },
      }),
      this.stockLines(user.organizationId, locationId, start, end),
      this.money(user.organizationId, locationId, start, end),
    ]);

    const counted = new Map((saved?.lines ?? []).map((l) => [l.productId, l.countedQuantity.toNumber()]));
    // A product counted earlier but with no stock or movement now still shows, with its count.
    const missing = [...counted.keys()].filter((id) => !lines.some((l) => l.productId === id));
    if (missing.length > 0) lines.push(...(await this.emptyLines(user.organizationId, missing)));
    for (const line of lines) line.countedQuantity = counted.get(line.productId) ?? null;

    const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toNumber());
    return {
      locationId,
      locationName: location.name,
      date,
      dayStart: start.toISOString(),
      dayEnd: end.toISOString(),
      savedAt: saved ? saved.updatedAt.toISOString() : null,
      savedByName: saved?.savedBy.fullName ?? null,
      openingCash: num(saved?.openingCash),
      countedCash: num(saved?.countedCash),
      countedCard: num(saved?.countedCard),
      countedTransfer: num(saved?.countedTransfer),
      note: saved?.note ?? null,
      money,
      lines,
    };
  }

  async save(user: AuthenticatedUser, dto: SaveDailyReconciliationDto): Promise<DailyReconciliationDto> {
    const locationId = requireLocationScope(user, dto.locationId);
    const { start } = businessDayRange(dto.date);
    if (start.getTime() > Date.now()) throw new BadRequestException("Этот день ещё не наступил");
    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    if (productIds.length !== dto.lines.length) throw new BadRequestException("Товар указан в сверке дважды");
    if (productIds.length > 0) {
      const known = await this.prisma.product.count({ where: { organizationId: user.organizationId, id: { in: productIds } } });
      if (known !== productIds.length) throw new BadRequestException("В сверке есть товар, которого нет в каталоге");
    }

    // The summary as it stands now, from the same figures the screen shows.
    const current = await this.get(user, locationId, dto.date);
    const countedById = new Map(dto.lines.map((l) => [l.productId, l.countedQuantity]));
    const summary = summarizeReconciliation({
      money: current.money,
      openingCash: dto.openingCash ?? null,
      countedCash: dto.countedCash ?? null,
      countedCard: dto.countedCard ?? null,
      countedTransfer: dto.countedTransfer ?? null,
      lines: current.lines.map((l) => ({ ...l, countedQuantity: countedById.get(l.productId) ?? null })),
    });

    const data = {
      openingCash: dto.openingCash ?? null,
      countedCash: dto.countedCash ?? null,
      countedCard: dto.countedCard ?? null,
      countedTransfer: dto.countedTransfer ?? null,
      note: dto.note?.trim() || null,
      moneyDifference: summary.moneyDifference,
      goodsDifference: summary.goodsDifference,
      result: summary.result,
      savedById: user.id,
    };
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.dailyReconciliation.findUnique({
        where: { organizationId_locationId_businessDate: { organizationId: user.organizationId, locationId, businessDate: dto.date } },
        select: { id: true, countedCash: true, countedCard: true, countedTransfer: true, openingCash: true, result: true },
      });
      const row = await tx.dailyReconciliation.upsert({
        where: { organizationId_locationId_businessDate: { organizationId: user.organizationId, locationId, businessDate: dto.date } },
        create: { organizationId: user.organizationId, locationId, businessDate: dto.date, ...data },
        update: data,
      });
      await tx.dailyReconciliationLine.deleteMany({ where: { reconciliationId: row.id } });
      if (dto.lines.length > 0) {
        await tx.dailyReconciliationLine.createMany({
          data: dto.lines.map((l) => ({ reconciliationId: row.id, productId: l.productId, countedQuantity: l.countedQuantity })),
        });
      }
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "dailyReconciliation.save",
        entityType: "DailyReconciliation",
        entityId: row.id,
        before,
        after: { date: dto.date, locationId, ...data, countedLines: dto.lines.length },
      });
    });
    return this.get(user, locationId, dto.date);
  }

  async history(user: AuthenticatedUser, requestedLocationId?: string): Promise<ReconciliationHistoryItemDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const rows = await this.prisma.dailyReconciliation.findMany({
      where: { organizationId: user.organizationId, ...(locationId ? { locationId } : {}) },
      include: { location: { select: { name: true } }, savedBy: { select: { fullName: true } } },
      orderBy: [{ businessDate: "desc" }, { updatedAt: "desc" }],
      take: 60,
    });
    const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
    return rows.map((r) => ({
      locationId: r.locationId,
      locationName: r.location.name,
      date: r.businessDate,
      moneyDifference: num(r.moneyDifference),
      goodsDifference: num(r.goodsDifference),
      result: num(r.result),
      savedAt: r.updatedAt.toISOString(),
      savedByName: r.savedBy.fullName,
    }));
  }

  // Opening = every movement before the day; the day's own movements split by kind.
  private async stockLines(organizationId: string, locationId: string, start: Date, end: Date): Promise<ReconciliationStockLineDto[]> {
    // A scrapped return's WRITE_OFF marker has no stock effect (see ledger-effects).
    const where = { organizationId, locationId, NOT: { type: "WRITE_OFF" as const, saleReturnId: { not: null } } };
    const [before, during] = await Promise.all([
      this.prisma.stockMovement.groupBy({ by: ["productId", "type"], where: { ...where, createdAt: { lt: start } }, _sum: { quantity: true } }),
      this.prisma.stockMovement.groupBy({ by: ["productId", "type"], where: { ...where, createdAt: { gte: start, lt: end } }, _sum: { quantity: true } }),
    ]);
    const effect = (g: { type: string; _sum: { quantity: Prisma.Decimal | null } }) => stockEffectOf({ type: g.type, quantity: g._sum.quantity?.toNumber() ?? 0 });

    type Acc = { opening: number; received: number; sold: number; returned: number; other: number; moved: boolean };
    const acc = new Map<string, Acc>();
    const of = (id: string) => {
      let a = acc.get(id);
      if (!a) acc.set(id, (a = { opening: 0, received: 0, sold: 0, returned: 0, other: 0, moved: false }));
      return a;
    };
    for (const g of before) of(g.productId).opening += effect(g);
    for (const g of during) {
      const e = effect(g);
      const a = of(g.productId);
      a.moved = true;
      if (g.type === "SALE") a.sold -= e;
      else if (g.type === "SALE_RETURN") a.returned += e;
      else if (RECEIVED.has(g.type)) a.received += e;
      else a.other += e;
    }

    const ids = [...acc.entries()].filter(([, a]) => a.moved || Math.abs(a.opening) > 1e-9).map(([id]) => id);
    if (ids.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids }, trackInventory: true },
      select: { id: true, name: true, sku: true, unit: true, price: true, consignmentSupplierId: true },
    });
    return products
      .map((p) => {
        const a = acc.get(p.id)!;
        const opening = round3(a.opening);
        const line: ReconciliationStockLineDto = {
          productId: p.id,
          productName: p.name,
          sku: p.sku,
          unit: p.unit as Unit,
          consignment: !!p.consignmentSupplierId,
          price: p.price.toNumber(),
          opening,
          received: round3(a.received),
          sold: round3(a.sold),
          returned: round3(a.returned),
          other: round3(a.other),
          closing: round3(a.opening + a.received - a.sold + a.returned + a.other),
          countedQuantity: null,
        };
        return line;
      })
      .sort((x, y) => Number(x.consignment) - Number(y.consignment) || x.productName.localeCompare(y.productName, "ru"));
  }

  private async emptyLines(organizationId: string, ids: string[]): Promise<ReconciliationStockLineDto[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, sku: true, unit: true, price: true, consignmentSupplierId: true },
    });
    return products.map((p) => ({
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      unit: p.unit as Unit,
      consignment: !!p.consignmentSupplierId,
      price: p.price.toNumber(),
      opening: 0,
      received: 0,
      sold: 0,
      returned: 0,
      other: 0,
      closing: 0,
      countedQuantity: null,
    }));
  }

  private async money(organizationId: string, locationId: string, start: Date, end: Date): Promise<ReconciliationMoneyDto> {
    const [sales, returns, tills] = await Promise.all([
      this.prisma.sale.findMany({
        where: { organizationId, locationId, soldAt: { gte: start, lt: end } },
        select: { totalAmount: true, amountPaid: true, paymentMethod: true, payments: { select: { method: true, amount: true } } },
      }),
      this.prisma.saleReturn.findMany({
        where: { organizationId, locationId, returnedAt: { gte: start, lt: end } },
        select: {
          id: true,
          totalAmount: true,
          sale: { select: { paymentMethod: true, payments: { select: { method: true, amount: true } } } },
          cashMovements: { select: { amount: true, account: { select: { type: true } } } },
        },
      }),
      this.prisma.cashAccount.findMany({ where: { organizationId, locationId, type: "CASH" }, select: { id: true } }),
    ]);

    const taken = new Map<string, number>();
    let onCredit = 0;
    // Same rule as the Sales summary: a split sale is its payment rows, anything
    // else is its single method for what was actually paid.
    for (const sale of sales) {
      const paid = sale.amountPaid.toNumber();
      onCredit += sale.totalAmount.toNumber() - paid;
      const tenders = sale.payments.length > 0 ? sale.payments.map((p) => ({ method: p.method, amount: p.amount.toNumber() })) : [{ method: sale.paymentMethod, amount: paid }];
      for (const t of tenders) {
        if (t.amount <= 0 || t.method === PaymentMethod.MIXED) continue;
        taken.set(t.method, (taken.get(t.method) ?? 0) + t.amount);
      }
    }

    // Refunds by tender. Cash is exact: what actually left the till for that
    // return. The rest goes back the way the sale was paid (D8), in proportion for a
    // split sale.
    const refunded = new Map<string, number>();
    const addRefund = (method: string, amount: number) => refunded.set(method, (refunded.get(method) ?? 0) + amount);
    for (const ret of returns) {
      const total = ret.totalAmount.toNumber();
      const sale = ret.sale;
      if (sale.paymentMethod !== PaymentMethod.MIXED) {
        addRefund(sale.paymentMethod, total);
        continue;
      }
      const cashOut = ret.cashMovements.filter((m) => m.account.type === "CASH").reduce((s, m) => s + m.amount.toNumber(), 0);
      if (cashOut > 0) addRefund(PaymentMethod.CASH, cashOut);
      const rest = round2(total - cashOut);
      const nonCash = sale.payments.filter((p) => p.method !== PaymentMethod.CASH).map((p) => ({ method: p.method, amount: p.amount.toNumber() }));
      if (rest > 0 && nonCash.some((t) => t.amount > 0)) {
        for (const part of allocateRefund(rest, nonCash)) addRefund(part.method, part.amount);
      }
    }

    const tillIds = tills.map((t) => t.id);
    const movements =
      tillIds.length === 0
        ? []
        : await this.prisma.cashMovement.findMany({
            where: { organizationId, accountId: { in: tillIds }, occurredAt: { gte: start, lt: end }, type: { notIn: [...TILL_SKIPPED] as never } },
            select: { type: true, amount: true },
          });
    const byType = new Map<string, number>();
    for (const m of movements) byType.set(m.type, (byType.get(m.type) ?? 0) + cashEffectOf({ type: m.type, amount: m.amount.toNumber() }));
    const tillMovements: ReconciliationTillMovementDto[] = [...byType.entries()]
      .map(([type, amount]) => ({ type: type as CashMovementType, amount: round2(amount) }))
      .filter((m) => m.amount !== 0);

    const get = (map: Map<string, number>, method: string) => round2(map.get(method) ?? 0);
    return {
      cashSales: get(taken, PaymentMethod.CASH),
      cashRefunds: get(refunded, PaymentMethod.CASH),
      tillMovements,
      cardSales: get(taken, PaymentMethod.CARD),
      cardRefunds: get(refunded, PaymentMethod.CARD),
      transferSales: get(taken, PaymentMethod.TRANSFER),
      transferRefunds: get(refunded, PaymentMethod.TRANSFER),
      onCredit: round2(onCredit),
    };
  }
}
