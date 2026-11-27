import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { BakerNoteKind as PrismaKind, BakerNoteStatus as PrismaStatus, LocationType, Prisma, ProductType } from "@prisma/client";
import {
  BAKER_DAY_ROLES,
  BAKER_NOTE_MAX_LINES,
  BAKER_PRINT_ROLES,
  BakerCatalogDto,
  BakerDayDto,
  BakerNoteDto,
  BakerNoteKind,
  BakerNoteStatus,
  BakerRecipientDto,
  ORG_WIDE_ROLES,
  Role,
  SaveBakerNoteRequestDto,
  Unit,
  bakerRecipientKey,
  partnerShortName,
  debtDateKey,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { round2, round3 } from "../common/money";
import { startOfZonedDate } from "../common/day-ranges";
import { priceListLocationId, priceListLocationMap } from "../common/price-source";
import { TelegramBotService } from "../telegram/telegram-bot.service";

type Db = PrismaService | Prisma.TransactionClient;

export const BAKER_NOTE_INCLUDE = {
  sourceLocation: { select: { name: true } },
  customer: { select: { name: true } },
  location: { select: { name: true } },
  lines: { include: { product: { select: { name: true, unit: true } } }, orderBy: { position: "asc" as const } },
  prints: { orderBy: { printedAt: "desc" as const }, take: 1, select: { printedAt: true, printedByName: true, contentKey: true } },
  _count: { select: { prints: true } },
  trip: { select: { number: true } },
} satisfies Prisma.BakerNoteInclude;
export type BakerNoteRow = Prisma.BakerNoteGetPayload<{ include: typeof BAKER_NOTE_INCLUDE }>;

// What a baker may put on a note: our own finished goods that are kept on the books.
const NOTE_PRODUCT = { isActive: true, type: ProductType.FINISHED_GOOD, trackInventory: true, consignmentSupplierId: null };

// What a printed накладная says: its recipient and lines. A note whose key differs from its last print's was changed.
export const noteContentKey = (row: { customerId: string | null; locationId: string | null; lines: { productId: string; quantity: Prisma.Decimal | number }[] }) =>
  [row.customerId ?? row.locationId ?? "", ...row.lines.map((l) => `${l.productId}:${Number(l.quantity)}`).sort()].join("|");

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

// «Накладные пекарей»: the notes themselves. A note is a draft — nothing here touches stock or money;
// BakerDayService turns a day's notes into documents.
@Injectable()
export class BakerNotesService {
  private readonly logger = new Logger(BakerNotesService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private telegram?: TelegramBotService,
  ) {}

  seesAll(user: AuthenticatedUser): boolean {
    return BAKER_DAY_ROLES.includes(user.role);
  }

  // Reads every note of a day: the day roles and the door laptop, which only prints (never edits).
  readsAll(user: AuthenticatedUser): boolean {
    return BAKER_PRINT_ROLES.includes(user.role);
  }

  // The door laptop sits at a shop but prints the workshop's notes, so it picks a workshop like an org-wide role.
  private pickedByPoint(user: AuthenticatedUser): boolean {
    return !ORG_WIDE_ROLES.includes(user.role) && user.role !== Role.DISPATCHER;
  }

  // The workshop the notes are written at: a person tied to a point works at that point; an org-wide
  // role picks one (the first workshop by default).
  async resolveSource(user: AuthenticatedUser, requested?: string): Promise<{ source: { id: string; name: string }; sources: { id: string; name: string }[] }> {
    if (this.pickedByPoint(user)) {
      if (!user.locationId) throw new ForbiddenException("Ваш аккаунт не привязан к производству — попросите указать точку в карточке сотрудника");
      if (requested && requested !== user.locationId) throw new ForbiddenException("Нет доступа к другой точке");
      const own = await this.prisma.location.findFirst({ where: { id: user.locationId, organizationId: user.organizationId }, select: { id: true, name: true } });
      if (!own) throw new NotFoundException("Точка не найдена");
      return { source: own, sources: [own] };
    }
    const workshops = await this.prisma.location.findMany({
      where: { organizationId: user.organizationId, isActive: true, type: LocationType.BAKERY_PRODUCTION },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (requested) {
      const found =
        workshops.find((w) => w.id === requested) ??
        (await this.prisma.location.findFirst({ where: { id: requested, organizationId: user.organizationId }, select: { id: true, name: true } }));
      if (!found) throw new NotFoundException("Точка не найдена");
      return { source: found, sources: workshops.some((w) => w.id === found.id) ? workshops : [...workshops, found] };
    }
    if (workshops.length === 0) throw new BadRequestException("В справочнике точек нет производства");
    return { source: workshops[0], sources: workshops };
  }

  private async recipients(organizationId: string, sourceId: string): Promise<BakerRecipientDto[]> {
    const [stores, customers] = await Promise.all([
      this.prisma.location.findMany({
        where: { organizationId, isActive: true, type: LocationType.STORE, id: { not: sourceId } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      this.prisma.customer.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    return [
      ...stores.map((s) => ({ kind: "location" as const, id: s.id, name: s.name })),
      ...customers.map((c) => ({ kind: "customer" as const, id: c.id, name: c.name })),
    ];
  }

  async catalog(user: AuthenticatedUser, requestedSource?: string): Promise<BakerCatalogDto> {
    const { source, sources } = await this.resolveSource(user, requestedSource);
    const organizationId = user.organizationId;
    const [recipients, products, pointPrices, agreed, priceSource] = await Promise.all([
      this.recipients(organizationId, source.id),
      this.prisma.product.findMany({
        where: { organizationId, ...NOTE_PRODUCT },
        orderBy: { name: "asc" },
        select: { id: true, name: true, sku: true, unit: true, price: true },
      }),
      this.prisma.productLocationPrice.findMany({ where: { organizationId }, select: { productId: true, locationId: true, price: true } }),
      this.prisma.standingOrderLine.findMany({
        where: { organizationId, customerId: { not: null }, unitPrice: { not: null } },
        select: { customerId: true, productId: true, unitPrice: true },
      }),
      priceListLocationMap(this.prisma, organizationId),
    ]);
    const known = new Set(products.map((p) => p.id));
    const byList = new Map<string, Record<string, number>>();
    for (const row of pointPrices) {
      if (!known.has(row.productId)) continue;
      let list = byList.get(row.locationId);
      if (!list) byList.set(row.locationId, (list = {}));
      list[row.productId] = row.price.toNumber();
    }
    const prices: Record<string, Record<string, number>> = {};
    for (const r of recipients) {
      if (r.kind !== "location") continue;
      const list = byList.get(priceSource.get(r.id) ?? r.id);
      if (list) prices[bakerRecipientKey("location", r.id)] = list;
    }
    for (const row of agreed) {
      if (!known.has(row.productId)) continue;
      (prices[bakerRecipientKey("customer", row.customerId!)] ??= {})[row.productId] = row.unitPrice!.toNumber();
    }
    return {
      day: debtDateKey(new Date()),
      sourceLocationId: source.id,
      sourceLocationName: source.name,
      sources,
      recipients,
      products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit as Unit, price: p.price.toNumber() })),
      prices,
      seesAll: this.seesAll(user),
      personalAccounts: (
        await this.prisma.cashAccount.findMany({
          where: { organizationId: user.organizationId, type: "PERSONAL", isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      ).map((a) => ({ id: a.id, name: partnerShortName(a.name) })),
    };
  }

  // The price of every product for one recipient: a point charges its price list, a wholesale customer
  // the agreed price, otherwise the product's base price.
  private async priceOf(db: Db, organizationId: string, target: { customerId: string | null; locationId: string | null }, productIds: string[]) {
    const special = new Map<string, number>();
    if (target.locationId) {
      const listId = await priceListLocationId(db, organizationId, target.locationId);
      const rows = await db.productLocationPrice.findMany({ where: { locationId: listId, productId: { in: productIds } }, select: { productId: true, price: true } });
      rows.forEach((r) => special.set(r.productId, r.price.toNumber()));
    } else if (target.customerId) {
      const rows = await db.standingOrderLine.findMany({
        where: { customerId: target.customerId, productId: { in: productIds }, unitPrice: { not: null } },
        select: { productId: true, unitPrice: true },
      });
      rows.forEach((r) => special.set(r.productId, r.unitPrice!.toNumber()));
    }
    return special;
  }

  private async cleanLines(db: Db, organizationId: string, dto: SaveBakerNoteRequestDto, target: { customerId: string | null; locationId: string | null }) {
    const lines = (dto.lines ?? []).filter((l) => l.quantity > 0);
    const fridge = dto.kind === BakerNoteKind.FRIDGE;
    if (!fridge && lines.length === 0) throw new BadRequestException("Добавьте хотя бы один товар");
    if (lines.length > BAKER_NOTE_MAX_LINES) throw new BadRequestException(`Не больше ${BAKER_NOTE_MAX_LINES} строк в одной накладной`);
    const ids = lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException("Один и тот же товар указан дважды");
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity > 100_000)) throw new BadRequestException("Проверьте количество");
    const products = await db.product.findMany({ where: { organizationId, id: { in: ids }, ...NOTE_PRODUCT }, select: { id: true, price: true } });
    if (products.length !== ids.length) throw new BadRequestException("Одного из товаров нет в программе — выберите товар из списка");
    const base = new Map(products.map((p) => [p.id, p.price.toNumber()]));
    const special = fridge ? new Map<string, number>() : await this.priceOf(db, organizationId, target, ids);
    const clean = lines.map((l, position) => {
      const quantity = round3(l.quantity);
      const unitPrice = fridge ? 0 : round2(special.get(l.productId) ?? base.get(l.productId) ?? 0);
      return { productId: l.productId, quantity, unitPrice, position };
    });
    return { lines: clean, total: round2(clean.reduce((s, l) => s + round2(l.quantity * l.unitPrice), 0)) };
  }

  private async target(organizationId: string, sourceId: string, dto: SaveBakerNoteRequestDto) {
    if (dto.kind === BakerNoteKind.FRIDGE) return { customerId: null, locationId: null };
    const customerId = dto.customerId || null;
    const locationId = dto.locationId || null;
    if ((customerId === null) === (locationId === null)) throw new BadRequestException("Выберите получателя");
    if (customerId) {
      const found = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId, isActive: true }, select: { id: true } });
      if (!found) throw new NotFoundException("Клиент не найден");
    } else {
      if (locationId === sourceId) throw new BadRequestException("Получатель совпадает с производством");
      const found = await this.prisma.location.findFirst({ where: { id: locationId!, organizationId, isActive: true }, select: { id: true } });
      if (!found) throw new NotFoundException("Точка не найдена");
    }
    return { customerId, locationId };
  }

  async create(user: AuthenticatedUser, dto: SaveBakerNoteRequestDto): Promise<BakerNoteDto> {
    if (dto.kind !== BakerNoteKind.DELIVERY && dto.kind !== BakerNoteKind.FRIDGE) throw new BadRequestException("Неизвестный вид накладной");
    const { source } = await this.resolveSource(user, dto.sourceLocationId);
    const organizationId = user.organizationId;
    const target = await this.target(organizationId, source.id, dto);
    const day = startOfZonedDate(debtDateKey(new Date()));

    // «Холодильник на завтра» is one sheet per workshop and day: saving again replaces it.
    if (dto.kind === BakerNoteKind.FRIDGE) {
      const existing = await this.prisma.bakerNote.findFirst({
        where: { organizationId, sourceLocationId: source.id, day, kind: PrismaKind.FRIDGE, status: { not: PrismaStatus.CANCELLED } },
        select: { id: true },
      });
      if (existing) return this.update(user, existing.id, dto);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const { lines, total } = await this.cleanLines(tx, organizationId, dto, target);
      // Numbers restart every Almaty day. Touching the organization row locks it until commit, so two
      // notes saved at the same moment never take the same number.
      await tx.organization.update({ where: { id: organizationId }, data: { bakerNoteSequence: { increment: 1 } }, select: { id: true } });
      const last = await tx.bakerNote.aggregate({ where: { organizationId, day }, _max: { number: true } });
      const created = await tx.bakerNote.create({
        data: {
          organizationId,
          number: (last._max.number ?? 0) + 1,
          kind: dto.kind as PrismaKind,
          day,
          sourceLocationId: source.id,
          ...target,
          comment: dto.comment?.trim().slice(0, 300) || null,
          total,
          createdById: user.id,
          createdByName: user.fullName,
          lines: { create: lines },
        },
        include: BAKER_NOTE_INCLUDE,
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "bakerNote.create",
        entityType: "BakerNote",
        entityId: created.id,
        after: { number: created.number, kind: created.kind, ...target, total, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })) },
      });
      return created;
    });
    if (row.kind === PrismaKind.DELIVERY) void this.pushTelegram(row);
    return this.toDto(row, user);
  }

  async update(user: AuthenticatedUser, id: string, dto: SaveBakerNoteRequestDto): Promise<BakerNoteDto> {
    const current = await this.load(user, id);
    this.assertEditable(user, current);
    if (dto.kind !== (current.kind as string)) throw new BadRequestException("Вид накладной не меняется");
    const organizationId = user.organizationId;
    // The recipient stays: another recipient is another note.
    const target = { customerId: current.customerId, locationId: current.locationId };
    const row = await this.prisma.$transaction(async (tx) => {
      const { lines, total } = await this.cleanLines(tx, organizationId, dto, target);
      // Only a note nobody has started posting may change.
      const claimed = await tx.bakerNote.updateMany({
        where: { id, status: PrismaStatus.SENT },
        data: { total, comment: dto.comment?.trim().slice(0, 300) || null, postError: null },
      });
      if (claimed.count !== 1) throw new BadRequestException("Накладная уже проведена — исправить её нельзя");
      await tx.bakerNoteLine.deleteMany({ where: { noteId: id } });
      if (lines.length > 0) await tx.bakerNoteLine.createMany({ data: lines.map((l) => ({ ...l, noteId: id })) });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "bakerNote.update",
        entityType: "BakerNote",
        entityId: id,
        before: { total: current.total.toNumber(), lines: current.lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber(), unitPrice: l.unitPrice.toNumber() })) },
        after: { total, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })) },
      });
      return tx.bakerNote.findUniqueOrThrow({ where: { id }, include: BAKER_NOTE_INCLUDE });
    });
    return this.toDto(row, user);
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<BakerNoteDto> {
    const current = await this.load(user, id);
    this.assertEditable(user, current);
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.bakerNote.updateMany({ where: { id, status: PrismaStatus.SENT }, data: { status: PrismaStatus.CANCELLED } });
      if (claimed.count !== 1) throw new BadRequestException("Накладная уже проведена — отменить её нельзя");
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "bakerNote.cancel",
        entityType: "BakerNote",
        entityId: id,
        before: { number: current.number, total: current.total.toNumber() },
      });
      return tx.bakerNote.findUniqueOrThrow({ where: { id }, include: BAKER_NOTE_INCLUDE });
    });
    return this.toDto(row, user);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<BakerNoteDto> {
    return this.toDto(await this.load(user, id), user);
  }

  // The day as its people see it: the operator every note, a baker their own; the fridge sheet is shared.
  async day(user: AuthenticatedUser, dayKey?: string, requestedSource?: string): Promise<BakerDayDto> {
    const { source, sources } = await this.resolveSource(user, requestedSource);
    const key = dayKey || debtDateKey(new Date());
    const day = startOfZonedDate(key);
    const rows = await this.prisma.bakerNote.findMany({
      where: {
        organizationId: user.organizationId,
        sourceLocationId: source.id,
        day,
        status: { not: PrismaStatus.CANCELLED },
        ...(this.readsAll(user) ? {} : { OR: [{ createdById: user.id }, { kind: PrismaKind.FRIDGE }] }),
      },
      include: BAKER_NOTE_INCLUDE,
      orderBy: { number: "asc" },
    });
    const fridge = rows.find((r) => r.kind === PrismaKind.FRIDGE);
    const pending = this.readsAll(user)
      ? await this.prisma.bakerNote.groupBy({
          by: ["day"],
          where: { organizationId: user.organizationId, sourceLocationId: source.id, kind: PrismaKind.DELIVERY, status: PrismaStatus.SENT, day: { not: day } },
          _count: { _all: true },
          orderBy: { day: "asc" },
        })
      : [];
    return {
      day: key,
      sourceLocationId: source.id,
      sourceLocationName: source.name,
      sources,
      notes: rows.filter((r) => r.kind === PrismaKind.DELIVERY).map((r) => this.toDto(r, user)),
      fridge: fridge ? this.toDto(fridge, user) : null,
      pendingDays: pending.map((p) => ({ day: debtDateKey(p.day), count: p._count._all })),
    };
  }

  // «Как вчера»: the latest earlier note to the same recipient (or the latest earlier fridge sheet).
  async previous(
    user: AuthenticatedUser,
    query: { kind?: string; customerId?: string; locationId?: string; sourceLocationId?: string },
  ): Promise<{ note: BakerNoteDto | null }> {
    const { source } = await this.resolveSource(user, query.sourceLocationId);
    const fridge = query.kind === BakerNoteKind.FRIDGE;
    if (!fridge && !query.customerId && !query.locationId) throw new BadRequestException("Выберите получателя");
    const row = await this.prisma.bakerNote.findFirst({
      where: {
        organizationId: user.organizationId,
        sourceLocationId: source.id,
        status: { not: PrismaStatus.CANCELLED },
        day: { lt: startOfZonedDate(debtDateKey(new Date())) },
        ...(fridge
          ? { kind: PrismaKind.FRIDGE }
          : { kind: PrismaKind.DELIVERY, ...(query.customerId ? { customerId: query.customerId } : { locationId: query.locationId }) }),
      },
      include: BAKER_NOTE_INCLUDE,
      orderBy: [{ day: "desc" }, { number: "desc" }],
    });
    return { note: row ? this.toDto(row, user) : null };
  }

  private async load(user: AuthenticatedUser, id: string): Promise<BakerNoteRow> {
    const row = await this.prisma.bakerNote.findFirst({ where: { id, organizationId: user.organizationId }, include: BAKER_NOTE_INCLUDE });
    if (!row) throw new NotFoundException("Накладная не найдена");
    if (this.pickedByPoint(user) && user.locationId !== row.sourceLocationId) throw new ForbiddenException("Нет доступа к другой точке");
    if (!this.readsAll(user) && row.createdById !== user.id && row.kind !== PrismaKind.FRIDGE) throw new ForbiddenException("Это накладная другого пекаря");
    return row;
  }

  private canEdit(user: AuthenticatedUser, row: { status: string; kind: string; createdById: string }): boolean {
    if (row.status !== PrismaStatus.SENT || user.role === Role.DISPATCHER) return false;
    return this.seesAll(user) || row.kind === PrismaKind.FRIDGE || row.createdById === user.id;
  }

  private assertEditable(user: AuthenticatedUser, row: BakerNoteRow): void {
    if (row.status === PrismaStatus.POSTED || row.status === PrismaStatus.POSTING) throw new BadRequestException("Накладная уже проведена — исправить её нельзя");
    if (row.status === PrismaStatus.CANCELLED) throw new BadRequestException("Накладная отменена");
    if (!this.canEdit(user, row)) throw new ForbiddenException("Это накладная другого пекаря");
  }

  toDto(row: BakerNoteRow, user: AuthenticatedUser): BakerNoteDto {
    const recipient: BakerRecipientDto | null = row.customerId
      ? { kind: "customer", id: row.customerId, name: row.customer?.name ?? "" }
      : row.locationId
        ? { kind: "location", id: row.locationId, name: row.location?.name ?? "" }
        : null;
    return {
      id: row.id,
      number: row.number,
      kind: row.kind as BakerNoteKind,
      status: row.status as BakerNoteStatus,
      day: debtDateKey(row.day),
      sourceLocationId: row.sourceLocationId,
      sourceLocationName: row.sourceLocation.name,
      recipient,
      lines: row.lines.map((l) => ({
        productId: l.productId,
        productName: l.product.name,
        unit: l.product.unit as Unit,
        quantity: l.quantity.toNumber(),
        unitPrice: l.unitPrice.toNumber(),
        subtotal: round2(l.quantity.toNumber() * l.unitPrice.toNumber()),
      })),
      total: row.total.toNumber(),
      comment: row.comment,
      createdById: row.createdById,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      postedAt: row.postedAt?.toISOString() ?? null,
      postedByName: row.postedByName,
      document: row.documentLabel,
      postError: row.postError,
      editable: this.canEdit(user, row),
      printedAt: row.prints[0]?.printedAt.toISOString() ?? null,
      printedByName: row.prints[0]?.printedByName ?? null,
      printCount: row._count.prints,
      changedSincePrint: row.prints.length > 0 && row.prints[0].contentKey !== noteContentKey(row),
      tripNumber: row.trip?.number ?? null,
    };
  }

  // «Напечатана»: a press of «Печать» on a screen, or the door laptop taking a request (`remote`). Moves nothing.
  async markPrinted(user: AuthenticatedUser, noteIds: string[], remote = false): Promise<{ marked: number }> {
    const ids = [...new Set(noteIds)].slice(0, 200);
    if (ids.length === 0) return { marked: 0 };
    const rows = await this.prisma.bakerNote.findMany({
      where: { id: { in: ids }, organizationId: user.organizationId, status: { not: PrismaStatus.CANCELLED } },
      select: { id: true, customerId: true, locationId: true, lines: { select: { productId: true, quantity: true } } },
    });
    if (rows.length === 0) return { marked: 0 };
    await this.prisma.bakerNotePrint.createMany({
      data: rows.map((r) => ({
        organizationId: user.organizationId,
        noteId: r.id,
        printedById: user.id,
        printedByName: user.fullName,
        remote,
        contentKey: noteContentKey(r),
      })),
    });
    return { marked: rows.length };
  }

  // The operator's Telegram: one line per new note. Never awaited — a slow Telegram must not hold the baker.
  private async pushTelegram(row: BakerNoteRow): Promise<void> {
    try {
      if (!this.telegram?.isEnabled()) return;
      const users = await this.prisma.user.findMany({
        where: {
          organizationId: row.organizationId,
          isActive: true,
          telegramId: { not: null },
          role: { in: BAKER_DAY_ROLES.filter((r) => r !== Role.ASSISTANT) },
          id: { not: row.createdById },
        },
        select: { telegramId: true, role: true, locationId: true },
      });
      const to = row.customer?.name ?? row.location?.name ?? "";
      const text =
        `📄 <b>Накладная № ${row.number}</b> → ${escapeHtml(to)}\n` +
        `Позиций: ${row.lines.length}, сумма ${money(row.total.toNumber())}\n` +
        `Пекарь: ${escapeHtml(row.createdByName)}`;
      for (const u of users) {
        if (!ORG_WIDE_ROLES.includes(u.role as Role) && u.locationId && u.locationId !== row.sourceLocationId) continue;
        await this.telegram.sendMessage(u.telegramId!, text).catch((err) => this.logger.warn(`Telegram: ${err instanceof Error ? err.message : err}`));
      }
    } catch (err) {
      this.logger.warn(`Baker note push failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
