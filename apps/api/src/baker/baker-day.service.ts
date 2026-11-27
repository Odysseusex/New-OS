import { createHash } from "crypto";
import { BadRequestException, ConflictException, HttpException, Injectable, Logger } from "@nestjs/common";
import { BakerNoteKind as PrismaKind, BakerNoteStatus as PrismaStatus, MaterialRequisitionKind, MaterialRequisitionStatus } from "@prisma/client";
import {
  BakerDayOutputLineDto,
  BakerDayPostRequestDto,
  BakerDayPostResultDto,
  BakerDayPreviewDto,
  BakerRecipientDto,
  PaymentMethod,
  ProductionReleasePreviewDto,
  Unit,
  UNIT_LABELS_RU,
  bakerDayOutput,
  debtDateKey,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { round3 } from "../common/money";
import { startOfZonedDate } from "../common/day-ranges";
import { ProductionService } from "../production/production.service";
import { MaterialRequisitionsService } from "../production/requisitions.service";
import { SalesService } from "../sales/sales.service";
import { CreateSaleDto } from "../sales/dto/create-sale.dto";
import { BAKER_NOTE_INCLUDE, BakerNoteRow, BakerNotesService } from "./baker-notes.service";

const STUCK_AFTER_MS = 3 * 60_000;
// Numbers restart every day, so the date is part of the text that names the transfer.
export const transferNote = (number: number, day: Date) => `Накладная пекаря № ${number} от ${debtDateKey(day).split("-").reverse().join(".")}`;
export const messageOf = (err: unknown) => {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    const message = typeof body === "string" ? body : (body as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join("; ") : (message ?? err.message);
  }
  return "Не удалось провести";
};

type Plan = {
  dayKey: string;
  source: { id: string; name: string };
  notes: BakerNoteRow[];
  fridge: BakerNoteRow | null;
  output: BakerDayOutputLineDto[];
  release: ProductionReleasePreviewDto | null;
  blockers: string[];
  warnings: string[];
  signature: string;
};

// «Провести день»: the day's notes become the ordinary documents.
//   выпуск = отгружено за день + холодильник на завтра − что числилось на производстве
// then a «Перемещение» per own point and a sale on account per wholesale customer, at the notes' prices.
// Nothing new is counted here: every document is made by the service that already makes it.
@Injectable()
export class BakerDayService {
  private readonly logger = new Logger(BakerDayService.name);
  // One posting at a time per workshop (the API is a single process).
  private readonly running = new Set<string>();

  // The automatic posting shares the lock with «Провести день»: never both at one workshop.
  tryLock(organizationId: string, sourceLocationId: string): boolean {
    const key = `${organizationId}:${sourceLocationId}`;
    if (this.running.has(key)) return false;
    this.running.add(key);
    return true;
  }

  unlock(organizationId: string, sourceLocationId: string): void {
    this.running.delete(`${organizationId}:${sourceLocationId}`);
  }

  constructor(
    private prisma: PrismaService,
    private notes: BakerNotesService,
    private production: ProductionService,
    private requisitions: MaterialRequisitionsService,
    private sales: SalesService,
  ) {}

  async preview(user: AuthenticatedUser, dayKey: string, sourceLocationId?: string): Promise<BakerDayPreviewDto> {
    const plan = await this.plan(user, dayKey, sourceLocationId);
    return {
      day: plan.dayKey,
      sourceLocationId: plan.source.id,
      sourceLocationName: plan.source.name,
      output: plan.output,
      release: plan.release,
      documents: plan.notes.map((n) => ({ noteId: n.id, number: n.number, recipient: recipientOf(n), lines: n.lines.length, total: n.total.toNumber() })),
      fridgeMissing: !plan.fridge,
      blockers: plan.blockers,
      warnings: plan.warnings,
      signature: plan.signature,
    };
  }

  async post(user: AuthenticatedUser, dto: BakerDayPostRequestDto): Promise<BakerDayPostResultDto> {
    const lockKey = `${user.organizationId}:${dto.sourceLocationId}`;
    if (this.running.has(lockKey)) throw new ConflictException("День уже проводится — подождите минуту и обновите экран");
    this.running.add(lockKey);
    try {
      const plan = await this.plan(user, dto.day, dto.sourceLocationId);
      if (plan.signature !== dto.signature) {
        throw new ConflictException("Пока вы смотрели, накладные или остатки изменились — нажмите «Провести день» ещё раз и проверьте заново");
      }
      if (plan.blockers.length > 0) throw new BadRequestException(plan.blockers[0]);

      const lines = plan.output.filter((l) => l.output > 0).map((l) => ({ productId: l.productId, quantity: l.output }));
      let released: BakerDayPostResultDto["released"] = null;
      if (lines.length > 0) {
        const result = await this.production.release(user, { locationId: plan.source.id, lines });
        released = { batches: result.batchIds.length, totalCost: result.totalCost };
      }

      const results: BakerDayPostResultDto["notes"] = [];
      for (const note of plan.notes) results.push(await this.postNote(user, note));

      if (plan.fridge && plan.fridge.status === PrismaStatus.SENT) {
        await this.prisma.bakerNote.updateMany({
          where: { id: plan.fridge.id, status: PrismaStatus.SENT },
          data: { status: PrismaStatus.POSTED, postedAt: new Date(), postedById: user.id, postedByName: user.fullName },
        });
      }
      await this.prisma
        .$transaction((tx) =>
          recordAudit(tx, {
            organizationId: user.organizationId,
            actorId: user.id,
            action: "bakerDay.post",
            entityType: "Location",
            entityId: plan.source.id,
            after: { day: plan.dayKey, released, output: lines, notes: results.map((r) => ({ number: r.number, ok: r.ok, message: r.message })) },
          }),
        )
        .catch((err) => this.logger.warn(`Audit of bakerDay.post failed: ${err instanceof Error ? err.message : err}`));
      return { released, notes: results, day: await this.notes.day(user, plan.dayKey, plan.source.id) };
    } finally {
      this.running.delete(lockKey);
    }
  }

  // One note → one document. The note is claimed first (only the request that flips SENT → POSTING goes
  // on), so it can never become two documents; a refusal puts it back with the reason.
  // `auto`: the automatic posting during the day — the note must not have changed since it was read, and
  // the documents say so («автоматически», the baker's name).
  async postNote(user: AuthenticatedUser, note: BakerNoteRow, auto = false): Promise<BakerDayPostResultDto["notes"][number]> {
    const recipientName = note.customer?.name ?? note.location?.name ?? "";
    const claimed = await this.prisma.bakerNote.updateMany({
      where: { id: note.id, status: PrismaStatus.SENT, ...(auto ? { contentChangedAt: note.contentChangedAt } : {}) },
      data: { status: PrismaStatus.POSTING, postingStartedAt: new Date(), postError: null },
    });
    if (claimed.count !== 1) return { noteId: note.id, number: note.number, recipientName, ok: false, message: "Накладная изменилась — проверьте её" };
    try {
      const lines = note.lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber(), unitPrice: l.unitPrice.toNumber() }));
      let done: { saleId?: string; requisitionId?: string; label: string };
      if (note.locationId) {
        const doc = await this.requisitions.transfer(user, {
          fromLocationId: note.sourceLocationId,
          toLocationId: note.locationId,
          note: transferNote(note.number, note.day) + (auto ? ` · автоматически (${note.createdByName})` : ""),
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        });
        done = { requisitionId: doc.id, label: `Перемещение № ${doc.number}` };
      } else {
        const sale = await this.sales.create(user, {
          locationId: note.sourceLocationId,
          customerId: note.customerId!,
          amountPaid: 0,
          paymentMethod: PaymentMethod.CASH,
          items: lines,
        } as CreateSaleDto);
        done = { saleId: sale.id, label: `Чек № ${sale.number ?? "—"}` };
      }
      await this.prisma.bakerNote.update({
        where: { id: note.id },
        data: {
          status: PrismaStatus.POSTED,
          postedAt: new Date(),
          postedById: user.id,
          postedByName: auto ? "Автоматически" : user.fullName,
          saleId: done.saleId ?? null,
          requisitionId: done.requisitionId ?? null,
          documentLabel: done.label,
          autoPostFailedAt: null,
          documents: { create: { kind: done.saleId ? "SALE" : "TRANSFER", documentId: (done.saleId ?? done.requisitionId)!, label: done.label } },
        },
      });
      return { noteId: note.id, number: note.number, recipientName, ok: true, message: done.label };
    } catch (err) {
      const message = messageOf(err);
      if (!(err instanceof HttpException)) this.logger.error(`Baker note ${note.number} failed to post`, err instanceof Error ? err.stack : String(err));
      await this.prisma.bakerNote.updateMany({ where: { id: note.id, status: PrismaStatus.POSTING }, data: { status: PrismaStatus.SENT, postError: message.slice(0, 500) } });
      return { noteId: note.id, number: note.number, recipientName, ok: false, message };
    }
  }

  // A note left «Проводится» by a server restart: if its document exists it is posted, otherwise it
  // goes back to the queue.
  async recoverStuck(organizationId: string): Promise<void> {
    const stuck = await this.prisma.bakerNote.findMany({
      where: { organizationId, status: PrismaStatus.POSTING, postingStartedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    });
    for (const note of stuck) {
      // A correction of an already posted note was cut short: the note is still posted (its lines say
      // what was applied).
      if (note.postedAt) {
        await this.prisma.bakerNote.updateMany({ where: { id: note.id, status: PrismaStatus.POSTING }, data: { status: PrismaStatus.POSTED } });
        continue;
      }
      let found: { saleId?: string; requisitionId?: string; label: string } | null = null;
      if (note.locationId) {
        const doc = await this.prisma.materialRequisition.findFirst({
          where: { organizationId, kind: MaterialRequisitionKind.TRANSFER, status: MaterialRequisitionStatus.POSTED, note: { startsWith: transferNote(note.number, note.day) }, toLocationId: note.locationId, ...(note.postingStartedAt ? { createdAt: { gte: note.postingStartedAt } } : {}) },
          select: { id: true, number: true },
        });
        if (doc) found = { requisitionId: doc.id, label: `Перемещение № ${doc.number}` };
      } else if (note.customerId && note.postingStartedAt) {
        const sale = await this.prisma.sale.findFirst({
          where: { organizationId, locationId: note.sourceLocationId, customerId: note.customerId, totalAmount: note.total, soldAt: { gte: note.postingStartedAt } },
          select: { id: true, number: true },
        });
        if (sale) found = { saleId: sale.id, label: `Чек № ${sale.number ?? "—"}` };
      }
      await this.prisma.bakerNote.updateMany({
        where: { id: note.id, status: PrismaStatus.POSTING },
        data: found
          ? {
              status: PrismaStatus.POSTED,
              postedAt: new Date(),
              saleId: found.saleId ?? null,
              requisitionId: found.requisitionId ?? null,
              documentLabel: found.label,
            }
          : { status: PrismaStatus.SENT, postError: "Проведение прервалось — проведите ещё раз" },
      });
      if (found) {
        await this.prisma.bakerNoteDocument.create({
          data: { noteId: note.id, kind: found.saleId ? "SALE" : "TRANSFER", documentId: (found.saleId ?? found.requisitionId)!, label: found.label },
        });
      }
    }
  }

  private async plan(user: AuthenticatedUser, dayKey: string, sourceLocationId?: string): Promise<Plan> {
    const { source } = await this.notes.resolveSource(user, sourceLocationId);
    const organizationId = user.organizationId;
    const key = dayKey || debtDateKey(new Date());
    const day = startOfZonedDate(key);
    if (key > debtDateKey(new Date())) throw new BadRequestException("Этот день ещё не наступил");
    await this.recoverStuck(organizationId);

    const rows = await this.prisma.bakerNote.findMany({
      where: { organizationId, sourceLocationId: source.id, day, status: { in: [PrismaStatus.SENT, PrismaStatus.POSTED, PrismaStatus.POSTING] } },
      include: BAKER_NOTE_INCLUDE,
      orderBy: { number: "asc" },
    });
    const notes = rows.filter((r) => r.kind === PrismaKind.DELIVERY && r.status === PrismaStatus.SENT);
    const fridge = rows.find((r) => r.kind === PrismaKind.FRIDGE) ?? null;
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (rows.some((r) => r.status === PrismaStatus.POSTING)) blockers.push("Одна из накладных ещё проводится — подождите пару минут и обновите экран");

    const info = new Map<string, { name: string; unit: Unit }>();
    const shipped = new Map<string, number>();
    for (const note of notes) {
      for (const l of note.lines) {
        info.set(l.productId, { name: l.product.name, unit: l.product.unit as Unit });
        shipped.set(l.productId, round3((shipped.get(l.productId) ?? 0) + l.quantity.toNumber()));
      }
    }
    const left = new Map<string, number>();
    for (const l of fridge?.lines ?? []) {
      info.set(l.productId, { name: l.product.name, unit: l.product.unit as Unit });
      left.set(l.productId, l.quantity.toNumber());
    }

    // What the books hold at the workshop now = what stayed from yesterday. With a fridge sheet in hand,
    // every finished product on the books is looked at (something on the books that nobody shipped or
    // left is shown, never silently «baked away»).
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        organizationId,
        locationId: source.id,
        OR: [
          { productId: { in: [...info.keys()] } },
          ...(fridge ? [{ quantity: { gt: 0 }, product: { type: "FINISHED_GOOD" as const, trackInventory: true, consignmentSupplierId: null, isActive: true } }] : []),
        ],
      },
      select: { productId: true, quantity: true, product: { select: { name: true, unit: true } } },
    });
    const onHand = new Map(levels.map((l) => [l.productId, l.quantity.toNumber()]));
    const recipes = await this.prisma.recipe.findMany({
      where: { organizationId, isActive: true, productId: { in: [...info.keys()] } },
      select: { productId: true },
    });
    const withRecipe = new Set(recipes.map((r) => r.productId));

    const output: BakerDayOutputLineDto[] = [...info]
      .map(([productId, p]) => {
        const s = shipped.get(productId) ?? 0;
        const f = left.get(productId) ?? 0;
        const have = round3(onHand.get(productId) ?? 0);
        return { productId, productName: p.name, unit: p.unit, shipped: s, fridge: f, onHand: have, ...bakerDayOutput(s, f, have), hasRecipe: withRecipe.has(productId) };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

    const qty = (n: number, unit: Unit) => `${n.toLocaleString("ru-RU")} ${UNIT_LABELS_RU[unit]}`;
    const noRecipe = output.filter((l) => l.output > 0 && !l.hasRecipe);
    if (noRecipe.length > 0) {
      blockers.push(
        `Нет действующей техкарты: ${noRecipe.map((l) => l.productName).join(", ")}. Выпуск по ним не посчитать — добавьте техкарту или оприходуйте товар через Склад → «Приёмка».`,
      );
    }
    if (!fridge && notes.length > 0) warnings.push("«Холодильник на завтра» не заполнен — остаток на производстве считается нулевым.");
    const surplus = [
      ...output.filter((l) => l.surplus > 0).map((l) => `${l.productName} (${qty(l.surplus, l.unit)})`),
      ...(fridge ? levels.filter((l) => !info.has(l.productId) && l.quantity.toNumber() > 0).map((l) => `${l.product.name} (${qty(round3(l.quantity.toNumber()), l.product.unit as Unit)})`) : []),
    ];
    if (surplus.length > 0) {
      warnings.push(
        `По учёту на производстве числится больше, чем отгружено и осталось: ${surplus.slice(0, 12).join(", ")}${surplus.length > 12 ? ` и ещё ${surplus.length - 12}` : ""}. Эти остатки не меняются — проверьте их отдельно.`,
      );
    }

    const releaseLines = output.filter((l) => l.output > 0 && l.hasRecipe).map((l) => ({ productId: l.productId, quantity: l.output }));
    let release: ProductionReleasePreviewDto | null = null;
    if (releaseLines.length > 0 && noRecipe.length === 0) {
      try {
        release = await this.production.previewRelease(user, { locationId: source.id, lines: releaseLines });
        const short = release.materials.filter((m) => m.shortage > 0);
        if (short.length > 0) {
          const text = `Не хватает сырья на производстве: ${short.map((m) => `${m.name} (${qty(m.shortage, m.unit)})`).join(", ")}`;
          if (release.allowNegativeStock) warnings.push(`${text}. Остаток уйдёт в минус.`);
          else blockers.push(`${text}. Оприходуйте сырьё или переместите его на производство.`);
        }
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        blockers.push(messageOf(err));
      }
    }
    if (notes.length === 0 && releaseLines.length === 0 && blockers.length === 0) blockers.push("Нечего проводить: новых накладных за этот день нет");

    const signature = createHash("sha256")
      .update(
        JSON.stringify([
          key,
          source.id,
          notes.map((n) => [n.id, n.updatedAt.getTime()]),
          fridge ? [fridge.id, fridge.updatedAt.getTime(), fridge.status] : null,
          output.map((l) => [l.productId, l.output]),
        ]),
      )
      .digest("hex")
      .slice(0, 32);
    return { dayKey: key, source, notes, fridge, output, release, blockers, warnings, signature };
  }
}

function recipientOf(note: BakerNoteRow): BakerRecipientDto {
  return note.customerId
    ? { kind: "customer", id: note.customerId, name: note.customer?.name ?? "" }
    : { kind: "location", id: note.locationId!, name: note.location?.name ?? "" };
}
