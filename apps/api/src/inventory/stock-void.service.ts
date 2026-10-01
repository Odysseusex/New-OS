import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CreateStockVoidRequestDto,
  STOCK_VOID_ROLES,
  StockMovementType,
  StockVoidCandidateDto,
  StockVoidDto,
  StockVoidLocationNetDto,
  StockVoidPreviewDto,
  Unit,
  WriteOffReason,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { CostingService } from "../costing/costing.service";
import { monthOf } from "../common/reporting-period";
import { postLedgerSources } from "../ledger/event-posting";
import { round2, round3 } from "../common/money";

type Client = Prisma.TransactionClient | PrismaService;

const MOVEMENT_INCLUDE = {
  location: { select: { name: true } },
  product: { select: { name: true, unit: true } },
  createdBy: { select: { fullName: true } },
  voidLine: { select: { voidId: true } },
} satisfies Prisma.StockMovementInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;

// Annulling an erroneous receipt/write-off pair (аннулирование).
//
// The situation it exists for: stock was received that never physically
// existed, and then written off only to take that phantom stock away again.
// Stock is already right (the two net to zero), so nothing about stock changes;
// what is wrong is the loss the write-off put into the profit and loss.
//
// A void is an append-only document linking the erroneous movements. They stay
// in the stock history, marked as annulled; they are never edited or deleted;
// and every loss/valuation figure leaves them out. There is deliberately no
// "undo": hiding a loss is a one-way statement, made by an owner or admin, with
// a reason, on the audit trail.
@Injectable()
export class StockVoidService {
  constructor(
    private prisma: PrismaService,
    private costing: CostingService = new CostingService(prisma),
  ) {}

  // ── what can be selected ────────────────────────────────────────────────

  // Why a movement cannot be part of a void. A real document behind it means
  // the goods were (or were claimed to be) delivered: that needs a supplier
  // return, not a void.
  static blockedReasonOf(m: {
    type: string;
    purchaseOrderId: string | null;
    invoiceId: string | null;
    batchId: string | null;
    saleId: string | null;
    saleReturnId: string | null;
    routeStopId: string | null;
    stocktakeId: string | null;
    voidLine: { voidId: string } | null;
  }): string | null {
    if (m.voidLine) return "Уже аннулировано";
    if (m.type !== StockMovementType.RECEIPT && m.type !== StockMovementType.WRITE_OFF) {
      return "Аннулируются только приход и списание";
    }
    if (m.purchaseOrderId || m.invoiceId) return "У прихода есть закупочный документ (заказ или накладная) — нужен возврат поставщику";
    if (m.batchId || m.routeStopId || m.stocktakeId) return "Движение связано с производством, доставкой или инвентаризацией";
    if (m.saleId || m.saleReturnId) return "Движение связано с продажей или возвратом";
    return null;
  }

  async candidates(user: AuthenticatedUser, productId: string): Promise<StockVoidCandidateDto[]> {
    this.assertRole(user);
    const rows = await this.prisma.stockMovement.findMany({
      where: { organizationId: user.organizationId, productId, type: { in: ["RECEIPT", "WRITE_OFF"] } },
      include: MOVEMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return rows.map((m) => ({
      id: m.id,
      type: m.type as StockMovementType,
      locationId: m.locationId,
      locationName: m.location.name,
      quantity: m.quantity.toNumber(),
      unit: m.product.unit as Unit,
      createdAt: m.createdAt.toISOString(),
      createdByName: m.createdBy.fullName,
      reason: m.reason,
      writeOffReason: m.writeOffReason as WriteOffReason | null,
      unitCost: m.unitCost?.toNumber() ?? null,
      blockedReason: StockVoidService.blockedReasonOf(m),
      voided: m.voidLine !== null,
    }));
  }

  // ── checking a selection ───────────────────────────────────────────────

  async preview(user: AuthenticatedUser, dto: Pick<CreateStockVoidRequestDto, "productId" | "movementIds">): Promise<StockVoidPreviewDto> {
    this.assertRole(user);
    const result = await this.evaluate(this.prisma, user.organizationId, dto, null);
    return { allowed: result.problems.length === 0, problems: result.problems, locations: result.locations, lossRemoved: result.lossRemoved, writeOffsWithoutStampedCost: result.withoutStamp };
  }

  // One place decides whether a selection is allowed, for the preview and for
  // the real thing alike, so they can never disagree.
  private async evaluate(
    client: Client,
    organizationId: string,
    dto: Pick<CreateStockVoidRequestDto, "productId" | "movementIds">,
    reason: string | null,
  ) {
    const problems: string[] = [];
    const ids = [...new Set(dto.movementIds ?? [])];
    if (reason !== null && reason.trim().length < 5) problems.push("Укажите причину аннулирования (не короче 5 символов)");
    if (ids.length === 0) {
      problems.push("Выберите приход и списание, которые нужно аннулировать");
      return { problems, rows: [] as MovementRow[], locations: [] as StockVoidLocationNetDto[], lossRemoved: 0, withoutStamp: 0 };
    }

    const rows = await client.stockMovement.findMany({ where: { id: { in: ids }, organizationId }, include: MOVEMENT_INCLUDE });
    if (rows.length !== ids.length) problems.push("Часть выбранных движений не найдена");
    if (rows.some((m) => m.productId !== dto.productId)) problems.push("Все движения должны относиться к одному товару");
    for (const m of rows) {
      const blocked = StockVoidService.blockedReasonOf(m);
      if (blocked) problems.push(`${m.type === "RECEIPT" ? "Приход" : "Списание"} от ${m.createdAt.toISOString().slice(0, 10)}: ${blocked}`);
    }

    // The pair must net to zero at every location: only then is stock already
    // right and a void able to leave it untouched.
    const byLocation = new Map<string, { name: string; received: Prisma.Decimal; written: Prisma.Decimal }>();
    for (const m of rows) {
      const entry = byLocation.get(m.locationId) ?? { name: m.location.name, received: new Prisma.Decimal(0), written: new Prisma.Decimal(0) };
      if (m.type === "RECEIPT") entry.received = entry.received.plus(m.quantity);
      else if (m.type === "WRITE_OFF") entry.written = entry.written.plus(m.quantity);
      byLocation.set(m.locationId, entry);
    }
    const locations: StockVoidLocationNetDto[] = [...byLocation.entries()].map(([locationId, v]) => ({
      locationId,
      locationName: v.name,
      received: v.received.toNumber(),
      writtenOff: v.written.toNumber(),
      net: v.received.minus(v.written).toNumber(),
    }));
    for (const l of locations) {
      if (l.net !== 0) {
        problems.push(
          `«${l.locationName}»: приход ${l.received} и списание ${l.writtenOff} не гасят друг друга (разница ${round3(l.net)}). ` +
            `Аннулируется только пара, которая в сумме даёт ноль — остаток при этом не меняется`,
        );
      }
    }
    if (rows.length > 0 && (!rows.some((m) => m.type === "RECEIPT") || !rows.some((m) => m.type === "WRITE_OFF"))) {
      problems.push("Нужны и приход, и списание, которое его убрало");
    }

    // A closed month's report is frozen: it cannot silently change under a void.
    const months = new Map<string, { year: number; month: number }>();
    for (const m of rows) {
      const k = monthOf(m.createdAt);
      months.set(`${k.year}-${k.month}`, k);
    }
    if (months.size > 0) {
      const periods = await client.financialPeriod.findMany({
        where: { organizationId, OR: [...months.values()].map((k) => ({ year: k.year, month: k.month })) },
        select: { year: true, month: true, status: true },
      });
      for (const p of periods) {
        if (p.status !== "OPEN") {
          problems.push(
            `Период ${String(p.month).padStart(2, "0")}.${p.year} закрыт — его отчёт заморожен. ` +
              `Сначала владелец переоткрывает период, затем аннулирование, затем период закрывается заново`,
          );
        }
      }
    }

    // What the profit and loss currently counts for the selected write-offs.
    const writeOffs = rows.filter((m) => m.type === "WRITE_OFF");
    const costs = await this.costing.currentUnitCosts(organizationId, client, [dto.productId]);
    const today = costs.get(dto.productId)?.unitCost ?? null;
    let lossRemoved = 0;
    let withoutStamp = 0;
    for (const m of writeOffs) {
      const unit = m.unitCost?.toNumber() ?? today;
      if (m.unitCost === null) withoutStamp += 1;
      if (unit !== null) lossRemoved += round2(m.quantity.toNumber() * unit);
    }
    return { problems, rows, locations, lossRemoved: round2(lossRemoved), withoutStamp };
  }

  // ── doing it ───────────────────────────────────────────────────────────

  async create(user: AuthenticatedUser, dto: CreateStockVoidRequestDto): Promise<StockVoidDto> {
    this.assertRole(user);
    const organizationId = user.organizationId;
    let voidId: string;
    try {
      voidId = await this.prisma.$transaction(async (tx) => {
        const check = await this.evaluate(tx, organizationId, dto, dto.reason ?? "");
        if (check.problems.length > 0) throw new BadRequestException(check.problems.join(". "));

        const created = await tx.stockVoid.create({
          data: { organizationId, productId: dto.productId, reason: dto.reason.trim(), createdById: user.id },
        });
        // The unique movementId is the real guard against two voids of one movement.
        await tx.stockVoidLine.createMany({ data: check.rows.map((m) => ({ organizationId, voidId: created.id, movementId: m.id })) });
        await recordAudit(tx, {
          organizationId,
          actorId: user.id,
          action: "stockVoid.create",
          entityType: "StockVoid",
          entityId: created.id,
          after: {
            productId: dto.productId,
            movements: check.rows.map((m) => ({ id: m.id, type: m.type, quantity: m.quantity.toNumber(), locationId: m.locationId, unitCost: m.unitCost?.toNumber() ?? null, at: m.createdAt })),
            lossRemoved: check.lossRemoved,
          },
          reason: dto.reason.trim(),
        });
        // With the general ledger on, entries already posted for these movements
        // are cancelled by reversal (they no longer project as events).
        await postLedgerSources(tx, { organizationId, actorId: user.id, scope: { stockMovementIds: check.rows.map((m) => m.id) } });
        return created.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new BadRequestException("Одно из выбранных движений уже аннулировано");
      }
      throw e;
    }
    return this.get(organizationId, voidId);
  }

  async list(user: AuthenticatedUser, productId?: string): Promise<StockVoidDto[]> {
    this.assertRole(user);
    const rows = await this.prisma.stockVoid.findMany({
      where: { organizationId: user.organizationId, ...(productId ? { productId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.get(user.organizationId, r.id)));
  }

  private async get(organizationId: string, id: string): Promise<StockVoidDto> {
    const v = await this.prisma.stockVoid.findFirstOrThrow({
      where: { id, organizationId },
      include: {
        product: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        lines: { include: { movement: { include: { location: { select: { name: true } } } } } },
      },
    });
    const costs = await this.costing.currentUnitCosts(organizationId, this.prisma, [v.productId]);
    const today = costs.get(v.productId)?.unitCost ?? null;
    let lossRemoved = 0;
    for (const l of v.lines) {
      if (l.movement.type !== "WRITE_OFF") continue;
      const unit = l.movement.unitCost?.toNumber() ?? today;
      if (unit !== null) lossRemoved += round2(l.movement.quantity.toNumber() * unit);
    }
    return {
      id: v.id,
      productId: v.productId,
      productName: v.product.name,
      reason: v.reason,
      createdAt: v.createdAt.toISOString(),
      createdByName: v.createdBy.fullName,
      lossRemoved: round2(lossRemoved),
      movements: v.lines
        .map((l) => ({ id: l.movementId, type: l.movement.type as StockMovementType, locationName: l.movement.location.name, quantity: l.movement.quantity.toNumber(), createdAt: l.movement.createdAt.toISOString() }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  // Defence in depth: the controller already gates the routes, but the service
  // is also called directly (tests, future callers).
  private assertRole(user: AuthenticatedUser) {
    if (!STOCK_VOID_ROLES.includes(user.role)) throw new ForbiddenException("Аннулировать может только владелец или администратор");
  }
}
