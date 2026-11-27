import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from "@nestjs/common";
import { BakerNoteKind as PrismaKind, BakerNoteStatus as PrismaStatus, BakerTripStatus as PrismaTripStatus, Prisma } from "@prisma/client";
import {
  BAKER_DAY_ROLES,
  BAKER_PHONE_ROLES,
  BAKER_TRIP_FORCE_ROLES,
  BakerTripActionResultDto,
  BakerTripDto,
  BakerTripStateDto,
  BakerTripStatus,
  Role,
  debtDateKey,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { startOfZonedDate } from "../common/day-ranges";
import { TelegramBotService } from "../telegram/telegram-bot.service";
import { noteContentKey } from "./baker-notes.service";
import { PrintJobsService } from "./print-jobs.service";
import { StaffPushService } from "./staff-push.service";

const TRIP_INCLUDE = { confirmations: { orderBy: { createdAt: "asc" as const } } } satisfies Prisma.BakerTripInclude;
type TripRow = Prisma.BakerTripGetPayload<{ include: typeof TRIP_INCLUDE }>;
type Db = PrismaService | Prisma.TransactionClient;

// The door laptop counts as «на связи» when it asked for work this recently (it asks every 4 s).
const LAPTOP_ONLINE_MS = 60_000;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const time = (d: Date) => d.toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });

// «Рейс»: the driver's run. Each baker presses «Рейс готов» when the car is loaded; the others are notified.
// When the last one has pressed, the day's new notes go to the door laptop as ONE print request and are
// marked with the trip. Nothing here moves stock or money.
@Injectable()
export class BakerTripsService {
  private readonly logger = new Logger(BakerTripsService.name);

  constructor(
    private prisma: PrismaService,
    private printJobs: PrintJobsService,
    private push: StaffPushService,
    @Optional() private telegram?: TelegramBotService,
  ) {}

  // The bakers who must press: everyone who signs in on a baker's phone (a baker role with a PIN).
  private requiredBakers(db: Db, organizationId: string) {
    return db.user.findMany({
      where: { organizationId, isActive: true, role: { in: BAKER_PHONE_ROLES }, pinDigest: { not: null } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    });
  }

  // Delivery notes of the day the next trip prints: never printed, or changed since their last print.
  private async newNoteIds(db: Db, organizationId: string, day: Date): Promise<string[]> {
    const rows = await db.bakerNote.findMany({
      where: { organizationId, day, kind: PrismaKind.DELIVERY, status: { not: PrismaStatus.CANCELLED } },
      orderBy: { number: "asc" },
      select: {
        id: true,
        customerId: true,
        locationId: true,
        lines: { select: { productId: true, quantity: true } },
        prints: { orderBy: { printedAt: "desc" }, take: 1, select: { contentKey: true } },
      },
    });
    return rows.filter((r) => r.lines.length > 0 && (r.prints.length === 0 || r.prints[0].contentKey !== noteContentKey(r))).map((r) => r.id);
  }

  private toDto(row: TripRow, bakers: { id: string; fullName: string }[]): BakerTripDto {
    const done = new Set(row.confirmations.map((c) => c.userId));
    return {
      id: row.id,
      number: row.number,
      status: row.status as BakerTripStatus,
      day: debtDateKey(row.day),
      createdAt: row.createdAt.toISOString(),
      launchedAt: row.launchedAt?.toISOString() ?? null,
      forcedByName: row.forcedByName,
      noteCount: row.noteCount,
      confirmed: row.confirmations.map((c) => ({ userId: c.userId, userName: c.userName, at: c.createdAt.toISOString() })),
      missing: row.status === PrismaTripStatus.WAITING ? bakers.filter((b) => !done.has(b.id)).map((b) => ({ userId: b.id, userName: b.fullName })) : [],
    };
  }

  private canConfirm(user: AuthenticatedUser): boolean {
    return BAKER_PHONE_ROLES.includes(user.role);
  }

  async state(user: AuthenticatedUser): Promise<BakerTripStateDto> {
    const organizationId = user.organizationId;
    const day = startOfZonedDate(debtDateKey(new Date()));
    const [waiting, last, bakers, newIds] = await Promise.all([
      this.prisma.bakerTrip.findFirst({ where: { organizationId, day, status: PrismaTripStatus.WAITING }, include: TRIP_INCLUDE }),
      this.prisma.bakerTrip.findFirst({ where: { organizationId, day, status: PrismaTripStatus.LAUNCHED }, orderBy: { number: "desc" }, include: TRIP_INCLUDE }),
      this.requiredBakers(this.prisma, organizationId),
      this.newNoteIds(this.prisma, organizationId, day),
    ]);
    return {
      waiting: waiting ? this.toDto(waiting, bakers) : null,
      last: last ? this.toDto(last, bakers) : null,
      newNotes: newIds.length,
      youConfirmed: !!waiting?.confirmations.some((c) => c.userId === user.id),
      canConfirm: this.canConfirm(user),
      canForce: BAKER_TRIP_FORCE_ROLES.includes(user.role),
      laptopSeenAt: this.printJobs.laptop(user).laptopSeenAt,
    };
  }

  // One trip decision at a time per organization: two bakers pressing together never make two trips.
  private async lockOrganization(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
  }

  // The waiting trip of today; one left waiting from an earlier day is dropped (its notes are simply still new).
  private async waitingTrip(tx: Prisma.TransactionClient, organizationId: string, day: Date): Promise<TripRow | null> {
    await tx.bakerTrip.updateMany({ where: { organizationId, status: PrismaTripStatus.WAITING, day: { lt: day } }, data: { status: PrismaTripStatus.CANCELLED } });
    return tx.bakerTrip.findFirst({ where: { organizationId, day, status: PrismaTripStatus.WAITING }, include: TRIP_INCLUDE });
  }

  private async newTrip(tx: Prisma.TransactionClient, organizationId: string, day: Date): Promise<TripRow> {
    const last = await tx.bakerTrip.aggregate({ where: { organizationId, day }, _max: { number: true } });
    return tx.bakerTrip.create({ data: { organizationId, day, number: (last._max.number ?? 0) + 1 }, include: TRIP_INCLUDE });
  }

  // The trip leaves: today's new notes become one print request on the door laptop.
  private async launch(tx: Prisma.TransactionClient, user: AuthenticatedUser, trip: TripRow, day: Date, forcedByName: string | null): Promise<TripRow> {
    const ids = await this.newNoteIds(tx, user.organizationId, day);
    let printJobId: string | null = null;
    if (ids.length > 0) {
      const job = await tx.printJob.create({
        data: { organizationId: user.organizationId, noteIds: ids, pack: true, createdById: user.id, createdByName: `Рейс ${trip.number}` },
      });
      printJobId = job.id;
      // A note reprinted because it changed keeps the trip it first went with.
      await tx.bakerNote.updateMany({ where: { id: { in: ids }, tripId: null }, data: { tripId: trip.id } });
    }
    await recordAudit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "bakerTrip.launch",
      entityType: "BakerTrip",
      entityId: trip.id,
      after: { number: trip.number, notes: ids.length, forced: forcedByName !== null },
    });
    return tx.bakerTrip.update({
      where: { id: trip.id },
      data: { status: PrismaTripStatus.LAUNCHED, launchedAt: new Date(), forcedByName, noteCount: ids.length, printJobId },
      include: TRIP_INCLUDE,
    });
  }

  // «Рейс готов» on a baker's phone.
  async confirm(user: AuthenticatedUser): Promise<BakerTripActionResultDto> {
    if (!this.canConfirm(user)) throw new ForbiddenException("«Рейс готов» нажимают пекари со своих телефонов");
    const organizationId = user.organizationId;
    const day = startOfZonedDate(debtDateKey(new Date()));
    const { trip, launched, added } = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      let trip = await this.waitingTrip(tx, organizationId, day);
      if (!trip) {
        if ((await this.newNoteIds(tx, organizationId, day)).length === 0) {
          throw new BadRequestException("Новых накладных нет — отправьте накладные, потом нажмите «Рейс готов»");
        }
        trip = await this.newTrip(tx, organizationId, day);
      }
      const already = trip.confirmations.some((c) => c.userId === user.id);
      if (!already) await tx.bakerTripConfirmation.create({ data: { tripId: trip.id, userId: user.id, userName: user.fullName } });
      const bakers = await this.requiredBakers(tx, organizationId);
      const done = new Set([...trip.confirmations.map((c) => c.userId), user.id]);
      const ready = bakers.every((b) => done.has(b.id));
      const current = await tx.bakerTrip.findUniqueOrThrow({ where: { id: trip.id }, include: TRIP_INCLUDE });
      if (!ready) return { trip: current, launched: false, added: !already };
      return { trip: await this.launch(tx, user, current, day, null), launched: true, added: !already };
    });
    const bakers = await this.requiredBakers(this.prisma, organizationId);
    const dto = this.toDto(trip, bakers);
    if (launched) void this.announceLaunch(user, dto, bakers);
    else if (added) void this.announceWaiting(user, dto);
    return { state: await this.state(user), launched: launched ? dto : null };
  }

  // A baker pressed by mistake: their press is taken back (a trip nobody is waiting for any more is dropped).
  async withdraw(user: AuthenticatedUser): Promise<BakerTripActionResultDto> {
    const organizationId = user.organizationId;
    const day = startOfZonedDate(debtDateKey(new Date()));
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const trip = await this.waitingTrip(tx, organizationId, day);
      if (!trip) return;
      await tx.bakerTripConfirmation.deleteMany({ where: { tripId: trip.id, userId: user.id } });
      const left = await tx.bakerTripConfirmation.count({ where: { tripId: trip.id } });
      // Nobody waits any more: the trip never happened (deleted, so its number is not skipped).
      if (left === 0) await tx.bakerTrip.delete({ where: { id: trip.id } });
    });
    return { state: await this.state(user), launched: null };
  }

  // «Запустить рейс сейчас»: a baker is off today, or the driver cannot wait.
  async force(user: AuthenticatedUser): Promise<BakerTripActionResultDto> {
    if (!BAKER_TRIP_FORCE_ROLES.includes(user.role)) throw new ForbiddenException("Недостаточно прав");
    const organizationId = user.organizationId;
    const day = startOfZonedDate(debtDateKey(new Date()));
    const trip = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      let trip = await this.waitingTrip(tx, organizationId, day);
      if (!trip) {
        if ((await this.newNoteIds(tx, organizationId, day)).length === 0) throw new BadRequestException("Новых накладных нет — печатать нечего");
        trip = await this.newTrip(tx, organizationId, day);
      }
      return this.launch(tx, user, trip, day, user.fullName);
    });
    const bakers = await this.requiredBakers(this.prisma, organizationId);
    const dto = this.toDto(trip, bakers);
    void this.announceLaunch(user, dto, bakers);
    return { state: await this.state(user), launched: dto };
  }

  // ── Notifications (never awaited by the request; a slow Telegram must not hold the baker) ──

  // Telegram to those who run the day (owner, admin, production manager, operator) with a linked account.
  private async telegramManagers(organizationId: string, text: string): Promise<void> {
    if (!this.telegram?.isEnabled()) return;
    const users = await this.prisma.user.findMany({
      where: { organizationId, isActive: true, telegramId: { not: null }, role: { in: BAKER_DAY_ROLES.filter((r) => r !== Role.ASSISTANT) } },
      select: { telegramId: true },
    });
    for (const u of users) {
      await this.telegram.sendMessage(u.telegramId!, text).catch((err) => this.logger.warn(`Telegram: ${err instanceof Error ? err.message : err}`));
    }
  }

  private async announceWaiting(user: AuthenticatedUser, trip: BakerTripDto): Promise<void> {
    try {
      await this.push.send(
        user.organizationId,
        trip.missing.map((m) => m.userId),
        { title: `Рейс ${trip.number}: ждём вас`, body: `${user.fullName} нажал(а) «Рейс готов». Нажмите и вы, когда машина загружена.`, tag: `trip-${trip.id}` },
      );
      await this.telegramManagers(
        user.organizationId,
        `⏳ <b>Рейс ${trip.number}</b>: ${escapeHtml(user.fullName)} нажал(а) «Рейс готов».\nЖдём: ${escapeHtml(trip.missing.map((m) => m.userName).join(", ") || "—")}`,
      );
    } catch (err) {
      this.logger.warn(`Trip waiting notice failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async announceLaunch(user: AuthenticatedUser, trip: BakerTripDto, bakers: { id: string }[]): Promise<void> {
    try {
      const seen = this.printJobs.laptop(user).laptopSeenAt;
      const online = !!seen && Date.now() - new Date(seen).getTime() < LAPTOP_ONLINE_MS;
      const printing =
        trip.noteCount === 0
          ? "Новых накладных не было — печатать нечего."
          : online
            ? `Накладных: ${trip.noteCount} — печатаются на ноутбуке выдачи.`
            : `Накладных: ${trip.noteCount}.\n⚠️ Ноутбук выдачи сейчас не на связи — накладные напечатаются, как только его включат и откроют «Выдачу накладных» (в течение 2 часов).`;
      const who = trip.forcedByName ? `Запустил(а) без ожидания: ${escapeHtml(trip.forcedByName)}` : `Нажали: ${escapeHtml(trip.confirmed.map((c) => c.userName).join(", "))}`;
      await this.telegramManagers(user.organizationId, `🚚 <b>Рейс ${trip.number} запущен</b> (${time(new Date(trip.launchedAt ?? Date.now()))})\n${who}\n${printing}`);
      await this.push.send(
        user.organizationId,
        bakers.map((b) => b.id).filter((id) => id !== user.id),
        { title: `Рейс ${trip.number} запущен`, body: trip.noteCount > 0 ? `Накладных: ${trip.noteCount}, ушли на печать.` : "Новых накладных не было.", tag: `trip-${trip.id}` },
      );
    } catch (err) {
      this.logger.warn(`Trip launch notice failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
