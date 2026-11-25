import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma, SupplierIntakePayment as PrismaPayment, SupplierIntakeStatus as PrismaStatus } from "@prisma/client";
import {
  BAKER_DAY_ROLES,
  CreateSupplierIntakeRequestDto,
  ResolveSupplierIntakeRequestDto,
  Role,
  SUPPLIER_INTAKE_MAX_PHOTOS,
  partnerShortName,
  supplierIntakePaymentLabel,
  SUPPLIER_INTAKE_PHOTO_MAX_CHARS,
  SupplierIntakeDto,
  SupplierIntakePayment,
  SupplierIntakeStatus,
  debtDateKey,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { round2 } from "../common/money";
import { addDays, startOfZonedDate } from "../common/day-ranges";
import { TelegramBotService } from "../telegram/telegram-bot.service";

const INCLUDE = {
  location: { select: { name: true } },
  photos: { select: { id: true, bytes: true, position: true }, orderBy: { position: "asc" as const } },
} satisfies Prisma.SupplierIntakeInclude;
type Row = Prisma.SupplierIntakeGetPayload<{ include: typeof INCLUDE }>;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (value: string | undefined, max: number) => value?.trim().slice(0, max) || null;

// «Приход от поставщика»: photographs of a supplier's накладная sent from the bakers' phones. Nothing
// here touches stock, money or the supplier's debt — whoever enters the goods does the ordinary приёмка
// and then marks the intake.
@Injectable()
export class SupplierIntakesService {
  private readonly logger = new Logger(SupplierIntakesService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private telegram?: TelegramBotService,
  ) {}

  private seesAll(user: AuthenticatedUser): boolean {
    return BAKER_DAY_ROLES.includes(user.role);
  }

  async create(user: AuthenticatedUser, dto: CreateSupplierIntakeRequestDto): Promise<SupplierIntakeDto> {
    if (!Object.values(SupplierIntakePayment).includes(dto.payment)) throw new BadRequestException("Выберите, как оплатили");
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, organizationId: user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!location) throw new NotFoundException("Выберите, куда привезли");
    // Paid out of a participant's pocket: which participant is one of the organization's personal accounts.
    let personal: { id: string; name: string } | null = null;
    if (dto.payment === SupplierIntakePayment.PERSONAL) {
      personal = dto.paymentAccountId
        ? await this.prisma.cashAccount.findFirst({
            where: { id: dto.paymentAccountId, organizationId: user.organizationId, type: "PERSONAL", isActive: true },
            select: { id: true, name: true },
          })
        : null;
      if (!personal) throw new BadRequestException("Выберите, чьими деньгами оплатили");
    }
    if (dto.total !== undefined && dto.total !== null && !(dto.total >= 0 && dto.total < 1e11)) throw new BadRequestException("Проверьте итог с накладной");
    const row = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id: user.organizationId },
        data: { supplierIntakeSequence: { increment: 1 } },
        select: { supplierIntakeSequence: true },
      });
      return tx.supplierIntake.create({
        data: {
          organizationId: user.organizationId,
          number: org.supplierIntakeSequence,
          locationId: location.id,
          payment: dto.payment as PrismaPayment,
          paymentAccountId: personal?.id ?? null,
          paymentAccountName: personal ? partnerShortName(personal.name) : null,
          supplierName: text(dto.supplierName, 120),
          total: dto.total === undefined || dto.total === null ? null : round2(dto.total),
          comment: text(dto.comment, 300),
          createdById: user.id,
          createdByName: user.fullName,
        },
        include: INCLUDE,
      });
    });
    return this.toDto(row);
  }

  // One page at a time (a photo is most of the 1 MB a request may carry), only while its author is
  // still sending it.
  async addPhoto(user: AuthenticatedUser, id: string, dataUrl: string): Promise<SupplierIntakeDto> {
    const intake = await this.own(user, id);
    if (intake.status !== PrismaStatus.UPLOADING) throw new BadRequestException("Приход уже отправлен — фото добавить нельзя");
    if (typeof dataUrl !== "string" || dataUrl.length > SUPPLIER_INTAKE_PHOTO_MAX_CHARS) throw new BadRequestException("Фото слишком большое");
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new BadRequestException("Это не фотография");
    const bytes = Buffer.from(match[2], "base64").length;
    if (bytes < 1000) throw new BadRequestException("Фото не открылось — снимите ещё раз");
    await this.prisma.$transaction(async (tx) => {
      // The intake row is locked so two uploads cannot both be «the eighth».
      await tx.$queryRaw`SELECT id FROM "supplier_intakes" WHERE id = ${id} FOR UPDATE`;
      const count = await tx.supplierIntakePhoto.count({ where: { intakeId: id } });
      if (count >= SUPPLIER_INTAKE_MAX_PHOTOS) throw new BadRequestException(`Не больше ${SUPPLIER_INTAKE_MAX_PHOTOS} фото в одном приходе`);
      await tx.supplierIntakePhoto.create({ data: { intakeId: id, position: count, mime: match[1], data: match[2], bytes } });
    });
    return this.toDto(await this.prisma.supplierIntake.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
  }

  async send(user: AuthenticatedUser, id: string): Promise<SupplierIntakeDto> {
    const intake = await this.own(user, id);
    if (intake.status !== PrismaStatus.UPLOADING) return this.toDto(intake);
    if (intake.photos.length === 0) throw new BadRequestException("Добавьте хотя бы одно фото накладной");
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierIntake.updateMany({ where: { id, status: PrismaStatus.UPLOADING }, data: { status: PrismaStatus.SENT, sentAt: new Date() } });
      if (claimed.count === 1) {
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          action: "supplierIntake.send",
          entityType: "SupplierIntake",
          entityId: id,
          after: { number: intake.number, locationId: intake.locationId, payment: intake.payment, paymentAccountId: intake.paymentAccountId, photos: intake.photos.length, supplierName: intake.supplierName, total: intake.total?.toNumber() ?? null },
        });
      }
      return tx.supplierIntake.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    void this.pushTelegram(row);
    return this.toDto(row);
  }

  // `pending`: everything still waiting, whatever the day (what «Помощник» works through). Otherwise
  // one Almaty day. A baker sees their own; the day roles see everyone's.
  async list(user: AuthenticatedUser, query: { day?: string; pending?: string }): Promise<SupplierIntakeDto[]> {
    const pending = query.pending === "true" || query.pending === "1";
    const key = query.day || debtDateKey(new Date());
    const rows = await this.prisma.supplierIntake.findMany({
      where: {
        organizationId: user.organizationId,
        ...(this.seesAll(user) ? {} : { createdById: user.id }),
        ...(pending
          ? { status: PrismaStatus.SENT }
          : { status: { not: PrismaStatus.UPLOADING }, sentAt: { gte: startOfZonedDate(key), lt: startOfZonedDate(addDays(key, 1)) } }),
      },
      include: INCLUDE,
      orderBy: { number: pending ? "asc" : "desc" },
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  // A baker's own latest intakes with their outcome («Проведён» / «Отклонён» and why).
  async mine(user: AuthenticatedUser): Promise<SupplierIntakeDto[]> {
    const rows = await this.prisma.supplierIntake.findMany({
      where: { organizationId: user.organizationId, createdById: user.id, status: { not: PrismaStatus.UPLOADING }, sentAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      include: INCLUDE,
      orderBy: { number: "desc" },
      take: 30,
    });
    return rows.map((r) => this.toDto(r));
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<SupplierIntakeDto> {
    return this.toDto(await this.load(user, id));
  }

  async photo(user: AuthenticatedUser, id: string, photoId: string): Promise<{ mime: string; bytes: Buffer }> {
    await this.load(user, id);
    const photo = await this.prisma.supplierIntakePhoto.findFirst({ where: { id: photoId, intakeId: id } });
    if (!photo) throw new NotFoundException("Фото не найдено");
    return { mime: photo.mime, bytes: Buffer.from(photo.data, "base64") };
  }

  // «Проведён» / «Отклонён» — once. It records what the person did elsewhere; it posts nothing itself.
  async resolve(user: AuthenticatedUser, id: string, dto: ResolveSupplierIntakeRequestDto): Promise<SupplierIntakeDto> {
    const intake = await this.load(user, id);
    if (intake.status !== PrismaStatus.SENT) throw new BadRequestException(intake.status === PrismaStatus.UPLOADING ? "Приход ещё не отправлен" : "Приход уже отмечен");
    let data: Prisma.SupplierIntakeUpdateManyMutationInput;
    if (dto.status === SupplierIntakeStatus.REJECTED) {
      const reason = dto.reason?.trim() ?? "";
      if (reason.length < 3) throw new BadRequestException("Напишите причину — пекарь её увидит");
      data = { status: PrismaStatus.REJECTED, rejectReason: reason.slice(0, 300) };
    } else if (dto.status === SupplierIntakeStatus.POSTED) {
      let label = text(dto.document, 200);
      let purchaseOrderId: string | null = null;
      if (dto.purchaseOrderId) {
        const order = await this.prisma.purchaseOrder.findFirst({ where: { id: dto.purchaseOrderId, organizationId: user.organizationId }, select: { id: true, number: true } });
        if (!order) throw new NotFoundException("Заказ поставщику не найден");
        purchaseOrderId = order.id;
        label = [`Заказ поставщику № ${order.number ?? "—"}`, label].filter(Boolean).join(" · ");
      }
      if (!label) throw new BadRequestException("Укажите документ: заказ поставщику или что именно проведено");
      data = { status: PrismaStatus.POSTED, purchaseOrderId, documentLabel: label };
    } else {
      throw new BadRequestException("Отметьте «Проведён» или «Отклонён»");
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierIntake.updateMany({
        where: { id, status: PrismaStatus.SENT },
        data: { ...data, resolvedAt: new Date(), resolvedById: user.id, resolvedByName: user.fullName },
      });
      if (claimed.count !== 1) throw new BadRequestException("Приход уже отмечен");
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "supplierIntake.resolve",
        entityType: "SupplierIntake",
        entityId: id,
        after: { number: intake.number, status: data.status as string, document: (data.documentLabel as string) ?? null, reason: (data.rejectReason as string) ?? null },
      });
      return tx.supplierIntake.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    return this.toDto(row);
  }

  private async load(user: AuthenticatedUser, id: string): Promise<Row> {
    const row = await this.prisma.supplierIntake.findFirst({ where: { id, organizationId: user.organizationId }, include: INCLUDE });
    if (!row) throw new NotFoundException("Приход не найден");
    if (!this.seesAll(user) && row.createdById !== user.id) throw new ForbiddenException("Это приход другого пекаря");
    if (row.status === PrismaStatus.UPLOADING && row.createdById !== user.id) throw new NotFoundException("Приход не найден");
    return row;
  }

  private async own(user: AuthenticatedUser, id: string): Promise<Row> {
    const row = await this.load(user, id);
    if (row.createdById !== user.id) throw new ForbiddenException("Это приход другого пекаря");
    return row;
  }

  private toDto(row: Row): SupplierIntakeDto {
    return {
      id: row.id,
      number: row.number,
      status: row.status as SupplierIntakeStatus,
      day: debtDateKey(row.sentAt ?? row.createdAt),
      locationId: row.locationId,
      locationName: row.location.name,
      payment: row.payment as SupplierIntakePayment,
      paymentLabel: supplierIntakePaymentLabel(row.payment as SupplierIntakePayment, row.paymentAccountName),
      paymentAccountId: row.paymentAccountId,
      supplierName: row.supplierName,
      total: row.total?.toNumber() ?? null,
      comment: row.comment,
      photos: row.photos.map((p) => ({ id: p.id, path: `/baker/intakes/${row.id}/photos/${p.id}`, bytes: p.bytes })),
      createdById: row.createdById,
      createdByName: row.createdByName,
      createdAt: (row.sentAt ?? row.createdAt).toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedByName: row.resolvedByName,
      rejectReason: row.rejectReason,
      document: row.documentLabel,
      purchaseOrderId: row.purchaseOrderId,
    };
  }

  // One Telegram line to whoever enters the goods. Never awaited: a slow Telegram must not hold the baker.
  private async pushTelegram(row: Row): Promise<void> {
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
        select: { telegramId: true },
      });
      const message =
        `📦 <b>Приход от ${escapeHtml(row.createdByName)}</b>: ${row.photos.length} фото, ` +
        `${escapeHtml(row.location.name)}, ${escapeHtml(supplierIntakePaymentLabel(row.payment as SupplierIntakePayment, row.paymentAccountName))}` +
        (row.supplierName ? `\nПоставщик: ${escapeHtml(row.supplierName)}` : "") +
        (row.total ? `\nИтог: ${Math.round(row.total.toNumber()).toLocaleString("ru-RU")} ₸` : "");
      for (const u of users) {
        await this.telegram.sendMessage(u.telegramId!, message).catch((err) => this.logger.warn(`Telegram: ${err instanceof Error ? err.message : err}`));
      }
    } catch (err) {
      this.logger.warn(`Supplier intake push failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
