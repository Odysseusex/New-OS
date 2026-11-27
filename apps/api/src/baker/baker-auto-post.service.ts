import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { BakerNoteKind as PrismaKind, BakerNoteStatus as PrismaStatus } from "@prisma/client";
import {
  BAKER_AUTO_POST_MAX_DELAY,
  BAKER_AUTO_POST_ROLES,
  BAKER_DAY_ROLES,
  BakerAutoPostSettingsDto,
  BakerNoteDocumentKind,
  BakerNoteDto,
  BakerNoteKind,
  ORG_WIDE_ROLES,
  PaymentMethod,
  Role,
  SaveBakerNoteRequestDto,
  bakerDayOutput,
  debtDateKey,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { round2, round3 } from "../common/money";
import { ProductionService } from "../production/production.service";
import { MaterialRequisitionsService } from "../production/requisitions.service";
import { SalesService } from "../sales/sales.service";
import { SaleReturnsService } from "../sales/sale-returns.service";
import { CreateSaleDto } from "../sales/dto/create-sale.dto";
import { TelegramBotService } from "../telegram/telegram-bot.service";
import { BAKER_NOTE_INCLUDE, BakerNoteRow, BakerNotesService } from "./baker-notes.service";
import { BakerDayService, messageOf, transferNote } from "./baker-day.service";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TICK_MS = 60_000;
const KICK_GAP_MS = 15_000;

type Delta = { productId: string; productName: string; quantity: number; unitPrice: number };

// «Проводить накладные пекарей сразу» (owner, 27.11.2026). While the notes waited for the night's
// «Провести день», the books lagged behind the shelf all day: halves of a cake delivered in the morning
// were not on the point's books at noon, so a sale «cut» a whole cake on paper that nobody cut.
//
// With the switch on, a delivery note posts ITSELF some minutes after its last change, exactly as
// «Провести день» would post that one note: a release of what the workshop is short of for it, then the
// transfer / the sale on account. A note already posted is corrected by a document for the difference.
// Off (the default) nothing here runs.
@Injectable()
export class BakerAutoPostService implements OnModuleInit {
  private readonly logger = new Logger(BakerAutoPostService.name);
  private busy = false;
  private lastKick = 0;

  constructor(
    private prisma: PrismaService,
    private notes: BakerNotesService,
    private days: BakerDayService,
    private production: ProductionService,
    private requisitions: MaterialRequisitionsService,
    private sales: SalesService,
    private saleReturns: SaleReturnsService,
    @Optional() private telegram?: TelegramBotService,
  ) {}

  onModuleInit(): void {
    // Specs call runDue() themselves.
    if (process.env.JEST_WORKER_ID) return;
    setInterval(() => void this.runDue(), TICK_MS).unref();
    setTimeout(() => void this.runDue(), 10_000).unref();
  }

  // Any request to the bakers' routes wakes the queue (the free server sleeps, so a timer alone is not enough).
  kick(): void {
    if (Date.now() - this.lastKick < KICK_GAP_MS) return;
    this.lastKick = Date.now();
    void this.runDue();
  }

  // ── Settings ──

  async settings(user: AuthenticatedUser): Promise<BakerAutoPostSettingsDto> {
    const s = await this.notes.autoPostSettings(user.organizationId);
    return { autoPost: s.autoPost, delayMinutes: s.autoPostDelayMinutes };
  }

  async saveSettings(user: AuthenticatedUser, dto: BakerAutoPostSettingsDto): Promise<BakerAutoPostSettingsDto> {
    if (!BAKER_AUTO_POST_ROLES.includes(user.role)) throw new ForbiddenException("Недостаточно прав");
    const delay = Math.round(dto.delayMinutes);
    if (!Number.isFinite(delay) || delay < 0 || delay > BAKER_AUTO_POST_MAX_DELAY) throw new BadRequestException(`Задержка — от 0 до ${BAKER_AUTO_POST_MAX_DELAY} минут`);
    const before = await this.notes.autoPostSettings(user.organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: user.organizationId },
        // Switched on = from this moment: notes sent earlier wait for «Провести день» as they always did.
        data: { bakerAutoPostDelayMinutes: delay, bakerAutoPostSince: dto.autoPost ? (before.since ?? new Date()) : null },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "bakerSettings.update",
        entityType: "Organization",
        entityId: user.organizationId,
        before: { autoPost: before.autoPost, delayMinutes: before.autoPostDelayMinutes },
        after: { autoPost: dto.autoPost, delayMinutes: delay },
      });
    });
    return { autoPost: dto.autoPost, delayMinutes: delay };
  }

  // ── The acting user ──
  // A baker may not make transfers or sales, so the documents are made as the organization's first
  // active owner (else admin): an org-wide role, tied to no point. The baker's name is in the transfer's
  // note and in the audit row.
  private async actor(organizationId: string): Promise<AuthenticatedUser> {
    const row =
      (await this.prisma.user.findFirst({ where: { organizationId, isActive: true, role: Role.OWNER }, orderBy: { createdAt: "asc" } })) ??
      (await this.prisma.user.findFirst({ where: { organizationId, isActive: true, role: Role.ADMIN }, orderBy: { createdAt: "asc" } }));
    if (!row) throw new BadRequestException("В организации нет действующего владельца или администратора — провести накладную некому");
    return { id: row.id, email: row.email, fullName: row.fullName, role: row.role as Role, title: row.title, organizationId, regionId: null, locationId: null };
  }

  // ── Release of what the workshop is short of ──
  // max(0, wanted − on hand) per product: the same formula as «Провести день» with an empty fridge.
  private async releaseShortage(actor: AuthenticatedUser, sourceLocationId: string, lines: { productId: string; productName: string; quantity: number }[]): Promise<void> {
    if (lines.length === 0) return;
    const ids = lines.map((l) => l.productId);
    const levels = await this.prisma.stockLevel.findMany({ where: { locationId: sourceLocationId, productId: { in: ids } }, select: { productId: true, quantity: true } });
    const onHand = new Map(levels.map((l) => [l.productId, l.quantity.toNumber()]));
    const short = lines.map((l) => ({ ...l, quantity: bakerDayOutput(l.quantity, 0, round3(onHand.get(l.productId) ?? 0)).output })).filter((l) => l.quantity > 0);
    if (short.length === 0) return;
    const recipes = await this.prisma.recipe.findMany({
      where: { organizationId: actor.organizationId, isActive: true, productId: { in: short.map((l) => l.productId) } },
      select: { productId: true },
    });
    const withRecipe = new Set(recipes.map((r) => r.productId));
    const noRecipe = short.filter((l) => !withRecipe.has(l.productId));
    if (noRecipe.length > 0) {
      throw new BadRequestException(
        `Нет действующей техкарты и нет на производстве: ${noRecipe.map((l) => l.productName).join(", ")}. Добавьте техкарту или оприходуйте товар через Склад → «Приёмка».`,
      );
    }
    await this.production.release(actor, { locationId: sourceLocationId, lines: short.map((l) => ({ productId: l.productId, quantity: l.quantity })) });
  }

  // ── Automatic posting ──

  // Never throws; one run at a time. Returns how many notes it posted (for specs).
  async runDue(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let posted = 0;
    try {
      const orgs = await this.prisma.organization.findMany({
        where: { bakerAutoPostSince: { not: null } },
        select: { id: true, bakerAutoPostSince: true, bakerAutoPostDelayMinutes: true },
      });
      for (const org of orgs) {
        await this.days.recoverStuck(org.id);
        const due = await this.prisma.bakerNote.findMany({
          where: {
            organizationId: org.id,
            kind: PrismaKind.DELIVERY,
            status: PrismaStatus.SENT,
            autoPostFailedAt: null,
            createdAt: { gte: org.bakerAutoPostSince! },
            contentChangedAt: { lte: new Date(Date.now() - org.bakerAutoPostDelayMinutes * 60_000) },
          },
          include: BAKER_NOTE_INCLUDE,
          orderBy: { createdAt: "asc" },
          take: 50,
        });
        for (const note of due) {
          if (await this.postOne(note)) posted += 1;
        }
      }
    } catch (err) {
      this.logger.error("Automatic posting of bakers' notes failed", err instanceof Error ? err.stack : String(err));
    } finally {
      this.busy = false;
    }
    return posted;
  }

  // One note. A refusal leaves it «Отправлена» with the reason and tells the people who run the day;
  // the other notes go on.
  private async postOne(note: BakerNoteRow): Promise<boolean> {
    // «Провести день» is running at this workshop: the next tick takes the note.
    if (!this.days.tryLock(note.organizationId, note.sourceLocationId)) return false;
    try {
      const actor = await this.actor(note.organizationId);
      await this.releaseShortage(
        actor,
        note.sourceLocationId,
        note.lines.map((l) => ({ productId: l.productId, productName: l.product.name, quantity: l.quantity.toNumber() })),
      );
      const result = await this.days.postNote(actor, note, true);
      if (!result.ok) {
        // Changed by the baker a moment ago: its delay starts again, nothing to report.
        const fresh = await this.prisma.bakerNote.findUnique({ where: { id: note.id }, select: { postError: true, status: true } });
        if (fresh?.status === PrismaStatus.SENT && fresh.postError) await this.failed(note, fresh.postError);
        return false;
      }
      await this.prisma
        .$transaction((tx) =>
          recordAudit(tx, {
            organizationId: note.organizationId,
            actorId: actor.id,
            action: "bakerNote.autoPost",
            entityType: "BakerNote",
            entityId: note.id,
            after: { number: note.number, day: debtDateKey(note.day), baker: note.createdByName, document: result.message, auto: true },
          }),
        )
        .catch((err) => this.logger.warn(`Audit of bakerNote.autoPost failed: ${err instanceof Error ? err.message : err}`));
      return true;
    } catch (err) {
      if (!(err instanceof HttpException)) this.logger.error(`Baker note ${note.number} failed to post automatically`, err instanceof Error ? err.stack : String(err));
      await this.failed(note, messageOf(err));
      return false;
    } finally {
      this.days.unlock(note.organizationId, note.sourceLocationId);
    }
  }

  private async failed(note: BakerNoteRow, message: string): Promise<void> {
    const marked = await this.prisma.bakerNote.updateMany({
      where: { id: note.id, status: PrismaStatus.SENT },
      data: { postError: message.slice(0, 500), autoPostFailedAt: new Date() },
    });
    if (marked.count !== 1) return;
    try {
      if (!this.telegram?.isEnabled()) return;
      const users = await this.prisma.user.findMany({
        where: { organizationId: note.organizationId, isActive: true, telegramId: { not: null }, role: { in: BAKER_DAY_ROLES.filter((r) => r !== Role.ASSISTANT) } },
        select: { telegramId: true, role: true, locationId: true },
      });
      const to = note.customer?.name ?? note.location?.name ?? "";
      const text = `⚠️ <b>Накладная пекаря № ${note.number}</b> → ${escapeHtml(to)} не провелась:\n${escapeHtml(message)}\nОна проведётся при «Провести день», когда причина будет устранена.`;
      for (const u of users) {
        if (!ORG_WIDE_ROLES.includes(u.role as Role) && u.locationId && u.locationId !== note.sourceLocationId) continue;
        await this.telegram.sendMessage(u.telegramId!, text).catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(`Notice about a failed baker note: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Saving a note: a sent one is edited, a posted one is corrected ──

  async save(user: AuthenticatedUser, id: string, dto: SaveBakerNoteRequestDto): Promise<BakerNoteDto> {
    const current = await this.notes.load(user, id);
    if (current.status !== PrismaStatus.POSTED) return this.notes.update(user, id, dto);
    return this.correct(user, current, dto);
  }

  // A posted document is never edited: the difference becomes documents of its own.
  //   to a point:    «+» a transfer workshop → point (a release first if the workshop is short), «−» a transfer back
  //   to a customer: «+» another sale on account at the note's prices, «−» a return on its sale (the debt first)
  // Each document is applied to the note's lines as soon as it exists, so the note always says what is
  // really posted — also when a later step is refused.
  private async correct(user: AuthenticatedUser, current: BakerNoteRow, dto: SaveBakerNoteRequestDto): Promise<BakerNoteDto> {
    const organizationId = user.organizationId;
    const settings = await this.notes.autoPostSettings(organizationId);
    if (!settings.autoPost) throw new BadRequestException("Накладная уже проведена — исправить её нельзя");
    if (!this.notes.canCorrect(user, current)) throw new ForbiddenException("Накладная уже проведена — сообщите оператору");
    if (dto.kind !== BakerNoteKind.DELIVERY) throw new BadRequestException("Вид накладной не меняется");
    const target = { customerId: current.customerId, locationId: current.locationId };
    const clean = await this.notes.cleanLines(this.prisma, organizationId, dto, target);

    const before = new Map(current.lines.map((l) => [l.productId, { quantity: l.quantity.toNumber(), unitPrice: l.unitPrice.toNumber(), name: l.product.name }]));
    const names = new Map((await this.prisma.product.findMany({ where: { id: { in: clean.lines.map((l) => l.productId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const plus: Delta[] = [];
    const minus: Delta[] = [];
    for (const l of clean.lines) {
      const was = before.get(l.productId);
      const delta = round3(l.quantity - (was?.quantity ?? 0));
      // A product already on the note keeps the price it was posted at.
      const unitPrice = was?.unitPrice ?? l.unitPrice;
      if (delta > 0) plus.push({ productId: l.productId, productName: names.get(l.productId) ?? "", quantity: delta, unitPrice });
      if (delta < 0) minus.push({ productId: l.productId, productName: names.get(l.productId) ?? "", quantity: -delta, unitPrice });
    }
    const kept = new Set(clean.lines.map((l) => l.productId));
    for (const [productId, was] of before) {
      if (!kept.has(productId)) minus.push({ productId, productName: was.name, quantity: was.quantity, unitPrice: was.unitPrice });
    }
    if (plus.length === 0 && minus.length === 0) return this.notes.toDto(current, user);

    const claimed = await this.prisma.bakerNote.updateMany({ where: { id: current.id, status: PrismaStatus.POSTED }, data: { status: PrismaStatus.POSTING, postingStartedAt: new Date() } });
    if (claimed.count !== 1) throw new ConflictException("Накладная сейчас проводится — подождите минуту и попробуйте ещё раз");
    const title = `Исправление: ${transferNote(current.number, current.day)} (${user.fullName})`;
    let applied = 0;
    let failure: unknown = null;
    try {
      const actor = await this.actor(organizationId);
      if (current.locationId) {
        if (minus.length > 0) {
          const doc = await this.requisitions.transfer(actor, {
            fromLocationId: current.locationId,
            toLocationId: current.sourceLocationId,
            note: `${title} — возврат на производство`,
            lines: minus.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          });
          await this.apply(current.id, minus, -1, { kind: "TRANSFER_BACK", documentId: doc.id, label: `Возврат на производство: перемещение № ${doc.number}` });
          applied += 1;
        }
        if (plus.length > 0) {
          await this.releaseShortage(actor, current.sourceLocationId, plus);
          const doc = await this.requisitions.transfer(actor, {
            fromLocationId: current.sourceLocationId,
            toLocationId: current.locationId,
            note: `${title} — добавлено`,
            lines: plus.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          });
          await this.apply(current.id, plus, 1, { kind: "TRANSFER", documentId: doc.id, label: `Добавлено: перемещение № ${doc.number}` });
          applied += 1;
        }
      } else {
        if (minus.length > 0) applied += await this.returnFromCustomer(actor, current, minus, title);
        if (plus.length > 0) {
          await this.releaseShortage(actor, current.sourceLocationId, plus);
          const sale = await this.sales.create(actor, {
            locationId: current.sourceLocationId,
            customerId: current.customerId!,
            amountPaid: 0,
            paymentMethod: PaymentMethod.CASH,
            items: plus.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
          } as CreateSaleDto);
          await this.apply(current.id, plus, 1, { kind: "SALE", documentId: sale.id, label: `Добавлено: чек № ${sale.number ?? "—"}` });
          applied += 1;
        }
      }
    } catch (err) {
      failure = err;
      if (!(err instanceof HttpException)) this.logger.error(`Correction of baker note ${current.number} failed`, err instanceof Error ? err.stack : String(err));
    } finally {
      await this.prisma.bakerNote.updateMany({ where: { id: current.id, status: PrismaStatus.POSTING }, data: { status: PrismaStatus.POSTED } });
    }

    const row = await this.prisma.bakerNote.findUniqueOrThrow({ where: { id: current.id }, include: BAKER_NOTE_INCLUDE });
    if (applied > 0) {
      const after = new Map(row.lines.map((l) => [l.productId, l.quantity.toNumber()]));
      const changes = [...new Set([...before.keys(), ...after.keys()])]
        .map((productId) => ({
          productId,
          productName: before.get(productId)?.name ?? names.get(productId) ?? "",
          before: before.get(productId)?.quantity ?? 0,
          after: after.get(productId) ?? 0,
        }))
        .filter((c) => c.before !== c.after);
      await this.prisma.$transaction(async (tx) => {
        await tx.bakerNoteRevision.create({ data: { noteId: current.id, actorId: user.id, actorName: user.fullName, changes } });
        await recordAudit(tx, {
          organizationId,
          actorId: user.id,
          action: "bakerNote.correct",
          entityType: "BakerNote",
          entityId: current.id,
          before: { number: current.number, total: current.total.toNumber() },
          after: { total: row.total.toNumber(), changes },
        });
      });
    }
    if (failure) {
      const message = messageOf(failure);
      throw new BadRequestException(applied > 0 ? `Часть изменений проведена, остальное — нет: ${message}` : message);
    }
    return this.notes.findOne(user, current.id);
  }

  // Goods taken back from a wholesale customer: a return on the note's own sales, newest first, each for
  // what is still returnable on it.
  private async returnFromCustomer(actor: AuthenticatedUser, note: BakerNoteRow, minus: Delta[], title: string): Promise<number> {
    const saleIds = [...new Set([...note.documents.filter((d) => d.kind === "SALE").map((d) => d.documentId), ...(note.saleId ? [note.saleId] : [])])];
    const sales = await this.prisma.sale.findMany({
      where: { id: { in: saleIds }, organizationId: note.organizationId },
      include: { items: true, returns: { include: { items: true } } },
      orderBy: { soldAt: "desc" },
    });
    const left = new Map(minus.map((l) => [l.productId, l.quantity]));
    let made = 0;
    for (const sale of sales) {
      const items: { productId: string; quantity: number }[] = [];
      for (const [productId, want] of left) {
        if (want <= 0) continue;
        const sold = sale.items.filter((i) => i.productId === productId).reduce((s, i) => s + i.quantity.toNumber(), 0);
        const returned = sale.returns.flatMap((r) => r.items).filter((i) => i.productId === productId).reduce((s, i) => s + i.quantity.toNumber(), 0);
        const take = round3(Math.min(want, sold - returned));
        if (take > 0) items.push({ productId, quantity: take });
      }
      if (items.length === 0) continue;
      const ret = await this.saleReturns.create(actor, sale.id, { items, restocked: true, reason: title });
      const part = items.map((i) => ({ ...minus.find((l) => l.productId === i.productId)!, quantity: i.quantity }));
      await this.apply(note.id, part, -1, { kind: "SALE_RETURN", documentId: ret.id, label: `Возврат по чеку № ${sale.number ?? "—"}` });
      for (const i of items) left.set(i.productId, round3((left.get(i.productId) ?? 0) - i.quantity));
      made += 1;
    }
    const rest = minus.filter((l) => (left.get(l.productId) ?? 0) > 0);
    if (rest.length > 0) throw new BadRequestException(`Вернуть больше, чем продано по накладной, нельзя: ${rest.map((l) => l.productName).join(", ")}`);
    return made;
  }

  // A document exists: the note's lines follow it at once, and the document is listed on the note.
  private async apply(noteId: string, deltas: Delta[], sign: 1 | -1, doc: { kind: BakerNoteDocumentKind; documentId: string; label: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const lines = await tx.bakerNoteLine.findMany({ where: { noteId } });
      let position = lines.reduce((m, l) => Math.max(m, l.position), -1);
      for (const d of deltas) {
        const line = lines.find((l) => l.productId === d.productId);
        const quantity = round3((line?.quantity.toNumber() ?? 0) + sign * d.quantity);
        if (line && quantity <= 0) await tx.bakerNoteLine.delete({ where: { id: line.id } });
        else if (line) await tx.bakerNoteLine.update({ where: { id: line.id }, data: { quantity } });
        else if (quantity > 0) await tx.bakerNoteLine.create({ data: { noteId, productId: d.productId, quantity, unitPrice: d.unitPrice, position: (position += 1) } });
      }
      const now = await tx.bakerNoteLine.findMany({ where: { noteId } });
      const total = round2(now.reduce((s, l) => s + round2(l.quantity.toNumber() * l.unitPrice.toNumber()), 0));
      await tx.bakerNote.update({ where: { id: noteId }, data: { total, contentChangedAt: new Date() } });
      await tx.bakerNoteDocument.create({ data: { noteId, kind: doc.kind, documentId: doc.documentId, label: doc.label } });
    });
  }
}
