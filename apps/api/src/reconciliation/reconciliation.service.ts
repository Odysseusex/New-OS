import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, StockMovementType as PrismaStockMovementType } from "@prisma/client";
import {
  CashMovementType,
  DailyReconciliationDto,
  PaymentMethod,
  ProductDayTrailDto,
  ReconciliationHistoryItemDto,
  StockMovementType,
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
import { CATEGORY_WITH_PARENT, categoryLabel } from "../common/category-label";
import { decrementStockOrThrow } from "../common/stock-guard";
import { CostingService } from "../costing/costing.service";
import { postLedgerSources } from "../ledger/event-posting";
import { SaveDailyReconciliationDto } from "./dto/reconciliation.dto";

// «Сверка дня»: the expected side is ALWAYS recomputed from the ledgers
// (StockMovement for the shelf, sales/returns/till movements for the money); only
// what was counted is stored. Saving moves no stock and no money.
//
// «Применить к остаткам» (apply) is the one step that does: once, it writes the
// counted DIFFERENCE of each line (counted − the day's closing) as an ADJUSTMENT
// linked to the worksheet. A difference, not "set to the count" — sales made
// after the evening count must not be undone. Those rows are left out of their
// own day's figures, so the worksheet keeps showing the shortage it found.

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

// The order of the screen and of the printed count sheet: our goods by category,
// then by name; goods «под реализацию» last; no category at the end of each.
const byShelfOrder = (x: ReconciliationStockLineDto, y: ReconciliationStockLineDto) =>
  Number(x.consignment) - Number(y.consignment) ||
  Number(x.categoryName === null) - Number(y.categoryName === null) ||
  (x.categoryName ?? "").localeCompare(y.categoryName ?? "", "ru") ||
  x.productName.localeCompare(y.productName, "ru");
// Money the worksheet takes from the sales and returns themselves, so the till's
// own rows for them are not counted twice; an opening balance is set-up, not trade.
const TILL_SKIPPED = new Set<string>([CashMovementType.SALE_RECEIPT, CashMovementType.SALE_REFUND, CashMovementType.OPENING_BALANCE]);

@Injectable()
export class ReconciliationService {
  constructor(
    private prisma: PrismaService,
    private costing: CostingService,
  ) {}

  async get(user: AuthenticatedUser, requestedLocationId: string | undefined, date: string): Promise<DailyReconciliationDto> {
    const locationId = requireLocationScope(user, requestedLocationId);
    const { start, end } = businessDayRange(date);
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId: user.organizationId }, select: { name: true } });
    if (!location) throw new NotFoundException("Точка не найдена");

    const saved = await this.prisma.dailyReconciliation.findUnique({
      where: { organizationId_locationId_businessDate: { organizationId: user.organizationId, locationId, businessDate: date } },
      include: { lines: true, savedBy: { select: { fullName: true } }, appliedBy: { select: { fullName: true } } },
    });
    const [lines, money] = await Promise.all([
      this.stockLines(user.organizationId, locationId, start, end, saved?.id ?? null),
      this.money(user.organizationId, locationId, start, end),
    ]);

    const counted = new Map((saved?.lines ?? []).map((l) => [l.productId, l.countedQuantity.toNumber()]));
    // A product counted earlier but with no stock or movement now still shows, with its count.
    const missing = [...counted.keys()].filter((id) => !lines.some((l) => l.productId === id));
    if (missing.length > 0) {
      lines.push(...(await this.emptyLines(user.organizationId, missing)));
      lines.sort(byShelfOrder);
    }
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
      appliedAt: saved?.appliedAt ? saved.appliedAt.toISOString() : null,
      appliedByName: saved?.appliedBy?.fullName ?? null,
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
    if (current.appliedAt) {
      // Stock was already corrected from these counts: changing them now would
      // leave stock and the worksheet telling different stories.
      const before = new Map(current.lines.filter((l) => l.countedQuantity !== null).map((l) => [l.productId, l.countedQuantity]));
      const same = before.size === dto.lines.length && dto.lines.every((l) => before.get(l.productId) === l.countedQuantity);
      if (!same) throw new BadRequestException("Остатки по этой сверке уже проведены — пересчёт товаров изменить нельзя");
    }
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

  // Once: the counted differences go into stock as ADJUSTMENT rows linked to the
  // worksheet, then its counts are locked. Uncounted lines are left alone.
  async apply(user: AuthenticatedUser, requestedLocationId: string | undefined, date: string): Promise<DailyReconciliationDto> {
    const locationId = requireLocationScope(user, requestedLocationId);
    const current = await this.get(user, locationId, date);
    if (!current.savedAt) throw new BadRequestException("Сначала сохраните сверку");
    if (current.appliedAt) throw new ConflictException("Остатки по этой сверке уже проведены");
    const differences = current.lines
      .filter((l) => l.countedQuantity !== null)
      .map((l) => ({ line: l, difference: round3((l.countedQuantity as number) - l.closing) }))
      .filter((d) => d.difference !== 0);

    const reason = `Сверка дня ${date.split("-").reverse().join(".")}`;
    await this.prisma.$transaction(
      async (tx) => {
        const saved = await tx.dailyReconciliation.findUniqueOrThrow({
          where: { organizationId_locationId_businessDate: { organizationId: user.organizationId, locationId, businessDate: date } },
          select: { id: true },
        });
        // Only one apply can win: a double click cannot correct stock twice.
        const flipped = await tx.dailyReconciliation.updateMany({
          where: { id: saved.id, appliedAt: null },
          data: { appliedAt: new Date(), appliedById: user.id },
        });
        if (flipped.count !== 1) throw new ConflictException("Остатки по этой сверке уже проведены");

        const products = await tx.product.findMany({
          where: { organizationId: user.organizationId, id: { in: differences.map((d) => d.line.productId) } },
          select: { id: true, minQuantity: true, trackInventory: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        const costs = await this.costing.snapshotCosts(user.organizationId, differences.map((d) => d.line.productId), tx);
        const movementIds: string[] = [];
        for (const { line, difference } of differences) {
          const product = byId.get(line.productId);
          if (!product?.trackInventory) continue;
          const movement = await tx.stockMovement.create({
            data: {
              organizationId: user.organizationId,
              locationId,
              productId: line.productId,
              type: PrismaStockMovementType.ADJUSTMENT,
              quantity: difference,
              reason,
              dailyReconciliationId: saved.id,
              createdById: user.id,
              ...this.costing.fields(costs.get(line.productId)),
            },
            select: { id: true },
          });
          movementIds.push(movement.id);
          if (difference < 0) {
            await decrementStockOrThrow(
              tx,
              { locationId, productId: line.productId, quantity: -difference },
              `Сейчас «${line.productName}» на остатке меньше, чем недостача по сверке — проверьте товар и поправьте его вручную`,
            );
          } else {
            await tx.stockLevel.upsert({
              where: { locationId_productId: { locationId, productId: line.productId } },
              update: { quantity: { increment: difference } },
              create: { organizationId: user.organizationId, locationId, productId: line.productId, quantity: difference, minQuantity: product.minQuantity },
            });
          }
        }
        await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { stockMovementIds: movementIds } });
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          action: "dailyReconciliation.apply",
          entityType: "DailyReconciliation",
          entityId: saved.id,
          after: { date, locationId, adjustedLines: movementIds.length },
        });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    return this.get(user, locationId, date);
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

  async productTrail(user: AuthenticatedUser, requestedLocationId: string | undefined, date: string, productId: string): Promise<ProductDayTrailDto> {
    const locationId = requireLocationScope(user, requestedLocationId);
    const { start, end } = businessDayRange(date);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: user.organizationId },
      select: { id: true, name: true, unit: true },
    });
    if (!product) throw new NotFoundException("Товар не найден");
    const where = { organizationId: user.organizationId, locationId, productId, NOT: { type: "WRITE_OFF" as const, saleReturnId: { not: null } } };
    const [before, movements] = await Promise.all([
      this.prisma.stockMovement.groupBy({ by: ["type"], where: { ...where, createdAt: { lt: start } }, _sum: { quantity: true } }),
      this.prisma.stockMovement.findMany({
        where: { ...where, createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: "asc" },
        select: {
          type: true,
          quantity: true,
          reason: true,
          createdAt: true,
          createdBy: { select: { fullName: true } },
          sale: { select: { totalAmount: true, paymentMethod: true, _count: { select: { items: true } } } },
        },
      }),
    ]);
    const opening = round3(before.reduce((sum, g) => sum + stockEffectOf({ type: g.type, quantity: g._sum.quantity?.toNumber() ?? 0 }), 0));
    let balance = opening;
    const rows = movements.map((m) => {
      const change = round3(stockEffectOf({ type: m.type, quantity: m.quantity.toNumber() }));
      balance = round3(balance + change);
      return {
        at: m.createdAt.toISOString(),
        type: m.type as StockMovementType,
        change,
        balance,
        byName: m.createdBy.fullName,
        reason: m.reason,
        sale: m.sale ? { total: m.sale.totalAmount.toNumber(), paymentMethod: m.sale.paymentMethod as PaymentMethod, itemsCount: m.sale._count.items } : null,
      };
    });
    return { productId: product.id, productName: product.name, unit: product.unit as Unit, date, opening, closing: balance, rows };
  }

  // Opening = every movement before the day; the day's own movements split by kind.
  private async stockLines(
    organizationId: string,
    locationId: string,
    start: Date,
    end: Date,
    ownReconciliationId: string | null,
  ): Promise<ReconciliationStockLineDto[]> {
    // A scrapped return's WRITE_OFF marker has no stock effect (see ledger-effects).
    // The worksheet's own corrections are not part of the day it checks.
    const where = {
      organizationId,
      locationId,
      NOT: { type: "WRITE_OFF" as const, saleReturnId: { not: null } },
      ...(ownReconciliationId ? { OR: [{ dailyReconciliationId: null }, { dailyReconciliationId: { not: ownReconciliationId } }] } : {}),
    };
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
      // Only what the shop sells (own goods and goods «под реализацию»): raw materials,
      // packaging and semi-finished stock are not part of the till's day.
      where: { organizationId, id: { in: ids }, trackInventory: true, type: "FINISHED_GOOD" },
      select: { id: true, name: true, sku: true, unit: true, price: true, consignmentSupplierId: true, categoryRef: CATEGORY_WITH_PARENT },
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
          categoryName: categoryLabel(p.categoryRef),
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
      .sort(byShelfOrder);
  }

  private async emptyLines(organizationId: string, ids: string[]): Promise<ReconciliationStockLineDto[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, sku: true, unit: true, price: true, consignmentSupplierId: true, categoryRef: CATEGORY_WITH_PARENT },
    });
    return products.map((p) => ({
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      unit: p.unit as Unit,
      categoryName: categoryLabel(p.categoryRef),
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
