import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  isValidBirthDate,
  LOYALTY_MAX_FAMILY_MEMBERS,
  LoyaltyFamilyMemberDto,
  LoyaltyMemberStatus,
  LoyaltyPointsEntryType,
  SaveLoyaltyFamilyMemberRequestDto,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { currentBirthday, DAY, giftEligible, localMidnight, toFamilyDto } from "./birthdays";
import { CustomerBotService } from "./customer-bot.service";
import { LoyaltyPointsService } from "./loyalty-points.service";

// Birthdays on a member's card (the holder and family) and the birthday gift.
@Injectable()
export class LoyaltyBirthdayService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LoyaltyBirthdayService.name);

  constructor(
    private prisma: PrismaService,
    private points: LoyaltyPointsService,
    private customerBot?: CustomerBotService,
  ) {}

  // ── the list on the card ─────────────────────────────────────────────────

  async add(user: AuthenticatedUser, memberId: string, dto: SaveLoyaltyFamilyMemberRequestDto): Promise<LoyaltyFamilyMemberDto> {
    const data = this.validate(dto);
    const member = await this.prisma.loyaltyMember.findFirst({ where: { id: memberId, organizationId: user.organizationId } });
    if (!member) throw new NotFoundException("Клиент не найден");
    if (member.status === LoyaltyMemberStatus.MERGED) throw new BadRequestException("Эта запись объединена с другой — добавьте день рождения в основную");
    const count = await this.prisma.loyaltyFamilyMember.count({ where: { memberId, archivedAt: null } });
    if (count >= LOYALTY_MAX_FAMILY_MEMBERS) throw new BadRequestException(`На одну карту — не больше ${LOYALTY_MAX_FAMILY_MEMBERS} дней рождения`);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.loyaltyFamilyMember.create({
        data: { organizationId: user.organizationId, memberId, ...data, createdById: user.id },
        include: { grants: { select: { year: true } } },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltyFamily.add",
        entityType: "LoyaltyMember",
        entityId: memberId,
        after: { familyMemberId: created.id, ...data },
      });
      return created;
    });
    return toFamilyDto(row);
  }

  async update(user: AuthenticatedUser, familyMemberId: string, dto: SaveLoyaltyFamilyMemberRequestDto): Promise<LoyaltyFamilyMemberDto> {
    const data = this.validate(dto);
    const existing = await this.getRow(user.organizationId, familyMemberId);
    const dateChanged =
      existing.birthDay !== data.birthDay || existing.birthMonth !== data.birthMonth || existing.birthYear !== data.birthYear;
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.loyaltyFamilyMember.update({
        where: { id: existing.id },
        // A changed date starts the 30-day rule again — otherwise editing the date
        // on the day would be a way round it.
        data: { ...data, ...(dateChanged ? { dateSetAt: new Date() } : {}) },
        include: { grants: { select: { year: true } } },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltyFamily.update",
        entityType: "LoyaltyMember",
        entityId: existing.memberId,
        before: { familyMemberId: existing.id, name: existing.name, relation: existing.relation, birthDay: existing.birthDay, birthMonth: existing.birthMonth, birthYear: existing.birthYear },
        after: { familyMemberId: existing.id, ...data },
      });
      return saved;
    });
    return toFamilyDto(row);
  }

  async remove(user: AuthenticatedUser, familyMemberId: string): Promise<{ removed: true }> {
    const existing = await this.getRow(user.organizationId, familyMemberId);
    await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyFamilyMember.update({ where: { id: existing.id }, data: { archivedAt: new Date() } });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltyFamily.remove",
        entityType: "LoyaltyMember",
        entityId: existing.memberId,
        before: { familyMemberId: existing.id, name: existing.name, birthDay: existing.birthDay, birthMonth: existing.birthMonth },
      });
    });
    return { removed: true };
  }

  // ── the gift ─────────────────────────────────────────────────────────────

  async onApplicationBootstrap() {
    // A free server sleeps through its cron; waking up is a chance to catch up.
    if (process.env.NODE_ENV === "test") return;
    setTimeout(() => void this.grantDue().catch((err) => this.logger.error("Birthday sweep failed", err instanceof Error ? err.stack : String(err))), 15_000);
  }

  // 12:15 Almaty every day.
  @Cron("15 7 * * *")
  async scheduled() {
    await this.grantDue().catch((err) => this.logger.error("Birthday sweep failed", err instanceof Error ? err.stack : String(err)));
  }

  // Grants every gift that is due and not yet given. Safe to run any number of
  // times: one grant per birthday row per year (unique), checked in the database.
  async grantDue(now = new Date(), organizationId?: string): Promise<number> {
    const settings = await this.prisma.loyaltySettings.findMany({
      where: { enabled: true, birthdayBonusPoints: { gt: 0 }, ...(organizationId ? { organizationId } : {}) },
    });
    let granted = 0;
    for (const s of settings) {
      const rows = await this.prisma.loyaltyFamilyMember.findMany({
        where: { organizationId: s.organizationId, archivedAt: null, member: { status: LoyaltyMemberStatus.ACTIVE } },
        include: { grants: { select: { year: true } } },
      });
      for (const row of rows) {
        const due = currentBirthday(now, row.birthMonth, row.birthDay);
        if (!due || row.grants.some((g) => g.year === due.year) || !giftEligible(row.dateSetAt, due.at)) continue;
        const expiresAt = new Date(due.at.getTime() + s.birthdayBonusDays * DAY);
        if (expiresAt <= now) continue;
        const points = s.birthdayBonusPoints.toNumber();
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.loyaltyBirthdayGrant.create({ data: { organizationId: s.organizationId, familyMemberId: row.id, year: due.year, points } });
            await this.points.settle(tx, s.organizationId, row.memberId, now);
            await tx.loyaltyPointsEntry.create({
              data: {
                organizationId: s.organizationId,
                memberId: row.memberId,
                type: LoyaltyPointsEntryType.BIRTHDAY,
                points,
                expiresAt,
                reason: `День рождения: ${row.name}`,
                createdByName: "Бонусная программа",
                createdAt: now,
              },
            });
          });
        } catch {
          continue; // granted a moment ago by another run
        }
        granted += 1;
        await this.customerBot?.notifyBirthday(row.memberId, row.name, points, new Date(expiresAt.getTime() - 1), `birthday:${row.id}:${due.year}`);
      }
    }
    if (granted) this.logger.log(`Birthday gifts granted: ${granted}`);
    return granted;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private validate(dto: SaveLoyaltyFamilyMemberRequestDto) {
    const name = dto.name?.trim() ?? "";
    if (name.length < 1 || name.length > 100) throw new BadRequestException("Укажите имя (до 100 символов)");
    const birthYear = dto.birthYear ?? null;
    if (!isValidBirthDate(dto.birthMonth, dto.birthDay, birthYear)) throw new BadRequestException("Неверная дата рождения");
    if (birthYear !== null && localMidnight(birthYear, dto.birthMonth, dto.birthDay) > new Date()) {
      throw new BadRequestException("Дата рождения в будущем");
    }
    const relation = dto.relation?.trim() || null;
    return { name, relation: relation ? relation.slice(0, 50) : null, birthDay: dto.birthDay, birthMonth: dto.birthMonth, birthYear };
  }

  private async getRow(organizationId: string, id: string) {
    const row = await this.prisma.loyaltyFamilyMember.findFirst({ where: { id, organizationId, archivedAt: null } });
    if (!row) throw new NotFoundException("День рождения не найден");
    return row;
  }
}
