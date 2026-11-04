import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TillShift } from "@prisma/client";
import {
  CashMovementType,
  CloseTillShiftRequestDto,
  OpenTillShiftRequestDto,
  PaymentMethod,
  TillShiftCashMoveDto,
  TillShiftCashRequestDto,
  TillShiftDetailDto,
  TillShiftDto,
  TillShiftReportDto,
  TillShiftStateDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope } from "../common/location-scope";
import { cashEffectOf } from "../common/ledger-effects";
import { round2 } from "../common/money";
import { recordAudit } from "../audit/audit";
import { tillTakings } from "../reconciliation/till-takings";
import { CashMovementsService } from "../finance/cash-movements.service";

// Sales and returns are read from their own documents; a till movement of these kinds is their money leg.
const TILL_SKIPPED = new Set<string>([CashMovementType.SALE_RECEIPT, CashMovementType.SALE_REFUND, CashMovementType.OPENING_BALANCE]);
const TENDERS = [PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER];

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

// Кассовая смена at one point. A shift is a time window over the point's own
// documents: it stores the count at the opening and at the close and the
// Z-report as it stood, never a copy of a sale. Внесение / выемка are ordinary
// transfers between the drawer and another own account, so the books need no
// new rule. Closing records the difference; it moves nothing.
@Injectable()
export class TillShiftsService {
  constructor(
    private prisma: PrismaService,
    private cash: CashMovementsService,
  ) {}

  async state(user: AuthenticatedUser, requestedLocationId: string | undefined): Promise<TillShiftStateDto> {
    const locationId = requireLocationScope(user, requestedLocationId);
    const [org, shift, till, accounts, last] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { tillShiftsRequired: true } }),
      this.openShift(user.organizationId, locationId),
      this.tillAccount(user.organizationId, locationId),
      this.prisma.cashAccount.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, locationId: true, type: true } }),
      this.prisma.tillShift.findFirst({ where: { locationId }, orderBy: { number: "desc" }, select: { number: true } }),
    ]);
    return {
      required: org.tillShiftsRequired,
      shift: shift ? await this.toDto(shift) : null,
      report: shift ? await this.report(shift, new Date()) : null,
      tillAccount: till ? { id: till.id, name: till.name, balance: till.currentBalance.toNumber() } : null,
      otherAccounts: accounts.filter((a) => a.id !== till?.id).map((a) => ({ id: a.id, name: a.name })),
      nextNumber: (last?.number ?? 0) + 1,
    };
  }

  async open(user: AuthenticatedUser, dto: OpenTillShiftRequestDto): Promise<TillShiftDto> {
    const locationId = requireLocationScope(user, dto.locationId);
    if (!(dto.openingCash >= 0)) throw new BadRequestException("Остаток наличных — число не меньше нуля");
    const till = await this.tillAccount(user.organizationId, locationId);
    if (!till) throw new BadRequestException("У точки нет кассы наличных — создайте счёт «Касса» с этой точкой в Финансах");
    try {
      const shift = await this.prisma.$transaction(async (tx) => {
        const last = await tx.tillShift.findFirst({ where: { locationId }, orderBy: { number: "desc" }, select: { number: true } });
        const created = await tx.tillShift.create({
          data: {
            organizationId: user.organizationId,
            locationId,
            number: (last?.number ?? 0) + 1,
            openedById: user.id,
            openedByName: user.fullName,
            openingCash: round2(dto.openingCash),
            bookCashAtOpen: till.currentBalance,
          },
        });
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          action: "tillShift.open",
          entityType: "TillShift",
          entityId: created.id,
          after: { number: created.number, openingCash: dto.openingCash, bookCash: till.currentBalance.toNumber() },
        });
        return created;
      });
      return this.toDto(shift);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException("На этой точке смена уже открыта");
      throw err;
    }
  }

  // Внесение (IN: from another account into the drawer) or выемка (OUT: from the drawer to another account).
  async moveCash(user: AuthenticatedUser, shiftId: string, dto: TillShiftCashRequestDto): Promise<TillShiftReportDto> {
    const shift = await this.ownOpenShift(user, shiftId);
    const till = await this.tillAccount(user.organizationId, shift.locationId);
    if (!till) throw new BadRequestException("У точки нет кассы наличных");
    if (!(dto.amount > 0)) throw new BadRequestException("Сумма должна быть больше нуля");
    const comment = dto.comment?.trim() ?? "";
    if (comment.length < 3) throw new BadRequestException("Напишите комментарий — для чего внесение или выемка");
    if (dto.accountId === till.id) throw new BadRequestException("Выберите другой счёт, не саму кассу");
    const label = dto.direction === "IN" ? "Внесение" : "Выемка";
    await this.cash.transfer(user, {
      fromAccountId: dto.direction === "IN" ? dto.accountId : till.id,
      toAccountId: dto.direction === "IN" ? till.id : dto.accountId,
      amount: round2(dto.amount),
      reason: `${label} (смена №${shift.number}): ${comment}`,
    });
    return this.report(shift, new Date());
  }

  async close(user: AuthenticatedUser, shiftId: string, dto: CloseTillShiftRequestDto): Promise<TillShiftDetailDto> {
    const shift = await this.ownOpenShift(user, shiftId);
    if (!(dto.countedCash >= 0)) throw new BadRequestException("Наличные в кассе — число не меньше нуля");
    const closedAt = new Date();
    const report = await this.report(shift, closedAt);
    const difference = round2(dto.countedCash - report.expectedCash);
    // Conditional on still being open, so two closes at once cannot both win.
    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.tillShift.updateMany({
        where: { id: shift.id, closedAt: null },
        data: {
          closedAt,
          closedById: user.id,
          closedByName: user.fullName,
          countedCash: round2(dto.countedCash),
          expectedCash: report.expectedCash,
          difference,
          report: report as unknown as Prisma.InputJsonValue,
          note: dto.note?.trim() || null,
        },
      });
      if (done.count === 0) throw new ConflictException("Смена уже закрыта");
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "tillShift.close",
        entityType: "TillShift",
        entityId: shift.id,
        after: { number: shift.number, expectedCash: report.expectedCash, countedCash: dto.countedCash, difference },
      });
      return tx.tillShift.findUniqueOrThrow({ where: { id: shift.id } });
    });
    return { ...(await this.toDto(updated)), report };
  }

  async list(user: AuthenticatedUser, requestedLocationId: string | undefined, from: Date, to: Date): Promise<TillShiftDto[]> {
    const where: Prisma.TillShiftWhereInput = { organizationId: user.organizationId, openedAt: { gte: from, lte: to } };
    if (requestedLocationId || user.locationId) where.locationId = requireLocationScope(user, requestedLocationId);
    const shifts = await this.prisma.tillShift.findMany({ where, orderBy: { openedAt: "desc" }, take: 500 });
    return Promise.all(shifts.map((s) => this.toDto(s)));
  }

  // A closed shift shows the Z-report it closed with; an open one is read live (X-отчёт).
  async detail(user: AuthenticatedUser, shiftId: string): Promise<TillShiftDetailDto> {
    const shift = await this.prisma.tillShift.findFirst({ where: { id: shiftId, organizationId: user.organizationId } });
    if (!shift) throw new NotFoundException("Смена не найдена");
    requireLocationScope(user, shift.locationId);
    const report = shift.closedAt && shift.report ? (shift.report as unknown as TillShiftReportDto) : await this.report(shift, new Date());
    return { ...(await this.toDto(shift)), report };
  }

  async setRequired(user: AuthenticatedUser, required: boolean): Promise<{ required: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: user.organizationId }, data: { tillShiftsRequired: required } });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "tillShift.setRequired",
        entityType: "Organization",
        entityId: user.organizationId,
        after: { required },
      });
    });
    return { required };
  }

  // ── internals ──

  private openShift(organizationId: string, locationId: string) {
    return this.prisma.tillShift.findFirst({ where: { organizationId, locationId, closedAt: null } });
  }

  private async ownOpenShift(user: AuthenticatedUser, shiftId: string): Promise<TillShift> {
    const shift = await this.prisma.tillShift.findFirst({ where: { id: shiftId, organizationId: user.organizationId } });
    if (!shift) throw new NotFoundException("Смена не найдена");
    requireLocationScope(user, shift.locationId);
    if (shift.closedAt) throw new BadRequestException("Смена уже закрыта");
    return shift;
  }

  // The drawer: the point's cash account (the default one first, if a point has several).
  private async tillAccount(organizationId: string, locationId: string) {
    return this.prisma.cashAccount.findFirst({
      where: { organizationId, locationId, type: "CASH", isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  private async report(shift: TillShift, until: Date): Promise<TillShiftReportDto> {
    const end = new Date(until.getTime() + 1);
    const tills = await this.prisma.cashAccount.findMany({ where: { organizationId: shift.organizationId, locationId: shift.locationId, type: "CASH" }, select: { id: true } });
    const tillIds = tills.map((t) => t.id);
    const [takings, movements] = await Promise.all([
      tillTakings(this.prisma, shift.organizationId, shift.locationId, shift.openedAt, end),
      tillIds.length === 0
        ? Promise.resolve([])
        : this.prisma.cashMovement.findMany({
            where: { organizationId: shift.organizationId, accountId: { in: tillIds }, occurredAt: { gte: shift.openedAt, lt: end }, type: { notIn: [...TILL_SKIPPED] as never } },
            orderBy: { occurredAt: "asc" },
            select: { type: true, amount: true, occurredAt: true, reason: true, transferGroupId: true, accountId: true, createdBy: { select: { fullName: true } }, categoryRef: { select: { name: true } } },
          }),
    ]);
    // The other side of a transfer: which account the money came from or went to.
    const groups = movements.map((m) => m.transferGroupId).filter((g): g is string => Boolean(g));
    const pairs = groups.length
      ? await this.prisma.cashMovement.findMany({
          where: { transferGroupId: { in: groups }, accountId: { notIn: tillIds } },
          select: { transferGroupId: true, account: { select: { name: true } } },
        })
      : [];
    const otherSide = new Map(pairs.map((p) => [p.transferGroupId as string, p.account.name]));

    const cashMoves: TillShiftCashMoveDto[] = movements.map((m) => ({
      at: m.occurredAt.toISOString(),
      amount: round2(cashEffectOf({ type: m.type, amount: m.amount.toNumber() })),
      // The stored reason carries «Выемка (смена №n): …» for the books; the report shows the cashier's words.
      comment: m.reason?.replace(/^(Внесение|Выемка) \(смена №\d+\): /, "") ?? null,
      byName: m.createdBy?.fullName ?? null,
      counterpart: m.transferGroupId ? (otherSide.get(m.transferGroupId) ?? null) : (m.categoryRef?.name ?? null),
    }));
    const cashMovesTotal = round2(cashMoves.reduce((s, m) => s + m.amount, 0));
    const get = (map: Map<string, number>, k: string) => round2(map.get(k) ?? 0);
    const cashSales = get(takings.taken, PaymentMethod.CASH);
    const cashRefunds = get(takings.refunded, PaymentMethod.CASH);
    const openingCash = shift.openingCash.toNumber();
    return {
      checks: takings.checks,
      returns: takings.returns,
      revenue: takings.revenue,
      tenders: TENDERS.map((method) => ({ method, sales: get(takings.taken, method), refunds: get(takings.refunded, method) })),
      onCredit: takings.onCredit,
      openingCash,
      cashSales,
      cashRefunds,
      cashMoves,
      cashMovesTotal,
      expectedCash: round2(openingCash + cashSales - cashRefunds + cashMovesTotal),
    };
  }

  private async toDto(s: TillShift): Promise<TillShiftDto> {
    const location = await this.prisma.location.findUnique({ where: { id: s.locationId }, select: { name: true } });
    return {
      id: s.id,
      locationId: s.locationId,
      locationName: location?.name ?? "",
      number: s.number,
      openedAt: s.openedAt.toISOString(),
      openedByName: s.openedByName,
      openingCash: s.openingCash.toNumber(),
      bookCashAtOpen: s.bookCashAtOpen.toNumber(),
      closedAt: s.closedAt?.toISOString() ?? null,
      closedByName: s.closedByName,
      countedCash: num(s.countedCash),
      expectedCash: num(s.expectedCash),
      difference: num(s.difference),
      note: s.note,
    };
  }
}
