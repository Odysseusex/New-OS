import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_LOYALTY_SETTINGS,
  floorToTiyn,
  isPointsEarningLine,
  loyaltyEarnPoints,
  LoyaltyMemberStatus,
  LoyaltyPointsEntryDto,
  LoyaltyPointsEntryType as T,
  LoyaltySettingsDto,
  LoyaltySummaryDto,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { addMonths, pointsPosition, PointsRow } from "./points-ledger";

type Db = Prisma.TransactionClient | PrismaService;

const round2 = (value: number) => Math.round(value * 100) / 100;
const MAX_MERGE_HOPS = 10;

export interface PreparedSaleLoyalty {
  memberId: string;
  settings: LoyaltySettingsDto;
  available: number;
}

export interface SaleLoyaltyLine {
  productId: string;
  quantity: number;
  subtotal: number;
  fullUnitPrice: number | null;
  loyaltyDiscount: number | null;
  consignment: boolean;
}

// The points ledger: the one place that writes LoyaltyPointsEntry rows. Sales,
// returns, merges and manual corrections all come through here, inside their
// own transaction, after locking the member row — so two tills can never spend
// the same points twice.
@Injectable()
export class LoyaltyPointsService {
  constructor(private prisma: PrismaService) {}

  // ── settings ──────────────────────────────────────────────────────────────

  async getSettings(organizationId: string, db: Db = this.prisma): Promise<LoyaltySettingsDto> {
    const row = await db.loyaltySettings.findUnique({ where: { organizationId } });
    if (!row) return { ...DEFAULT_LOYALTY_SETTINGS };
    return {
      enabled: row.enabled,
      firstPurchaseEarnPercent: row.firstPurchaseEarnPercent.toNumber(),
      earnPercent: row.earnPercent.toNumber(),
      maxRedeemPercent: row.maxRedeemPercent.toNumber(),
      pointsLifetimeMonths: row.pointsLifetimeMonths,
      birthdayBonusPoints: row.birthdayBonusPoints.toNumber(),
      birthdayBonusDays: row.birthdayBonusDays,
      whatsappSaleNotices: row.whatsappSaleNotices,
      whatsappExpiryNotices: row.whatsappExpiryNotices,
      whatsappBirthdayNotices: row.whatsappBirthdayNotices,
    };
  }

  async updateSettings(user: AuthenticatedUser, dto: Partial<LoyaltySettingsDto>): Promise<LoyaltySettingsDto> {
    for (const key of ["firstPurchaseEarnPercent", "earnPercent", "maxRedeemPercent"] as const) {
      const value = dto[key];
      if (value !== undefined && (value < 0 || value > 100 || Math.round(value * 100) !== value * 100)) {
        throw new BadRequestException("Процент — число от 0 до 100, не больше двух знаков после запятой");
      }
    }
    if (dto.pointsLifetimeMonths !== undefined && (!Number.isInteger(dto.pointsLifetimeMonths) || dto.pointsLifetimeMonths < 1 || dto.pointsLifetimeMonths > 120)) {
      throw new BadRequestException("Срок жизни баллов — целое число месяцев от 1 до 120");
    }
    const gift = dto.birthdayBonusPoints;
    if (gift !== undefined && (gift < 0 || Math.round(gift * 100) !== gift * 100)) {
      throw new BadRequestException("Подарок на день рождения — неотрицательное число баллов, не больше двух знаков после запятой");
    }
    if (dto.birthdayBonusDays !== undefined && (!Number.isInteger(dto.birthdayBonusDays) || dto.birthdayBonusDays < 1 || dto.birthdayBonusDays > 365)) {
      throw new BadRequestException("Срок подарка — целое число дней от 1 до 365");
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await this.getSettings(user.organizationId, tx);
      const after = { ...before, ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) } as LoyaltySettingsDto;
      await tx.loyaltySettings.upsert({
        where: { organizationId: user.organizationId },
        create: { organizationId: user.organizationId, ...after, updatedById: user.id },
        update: { ...after, updatedById: user.id },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltySettings.update",
        entityType: "LoyaltySettings",
        entityId: user.organizationId,
        before,
        after,
      });
      return after;
    });
  }

  // ── reading balances ──────────────────────────────────────────────────────

  async balances(organizationId: string, memberIds: string[], db: Db = this.prisma): Promise<Map<string, number>> {
    if (memberIds.length === 0) return new Map();
    const rows = await db.loyaltyPointsEntry.findMany({
      where: { organizationId, memberId: { in: memberIds } },
      select: { id: true, memberId: true, type: true, points: true, expiresAt: true, createdAt: true },
    });
    const byMember = new Map<string, PointsRow[]>();
    for (const r of rows) {
      const list = byMember.get(r.memberId) ?? [];
      list.push({ ...r, points: r.points.toNumber() });
      byMember.set(r.memberId, list);
    }
    const now = new Date();
    return new Map(memberIds.map((id) => [id, pointsPosition(byMember.get(id) ?? [], now).available]));
  }

  async history(organizationId: string, memberId: string): Promise<LoyaltyPointsEntryDto[]> {
    const rows = await this.prisma.loyaltyPointsEntry.findMany({
      where: { organizationId, memberId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type as T,
      points: r.points.toNumber(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      saleId: r.saleId,
      ratePercent: r.ratePercent?.toNumber() ?? null,
      reason: r.reason,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // Writes off what has expired, so the history says so. Called (under the member
  // lock) before anything else touches the balance.
  async settle(tx: Prisma.TransactionClient, organizationId: string, memberId: string, now = new Date()) {
    await tx.$queryRaw`SELECT id FROM loyalty_members WHERE id = ${memberId} FOR UPDATE`;
    const rows = await this.rows(tx, memberId);
    const position = pointsPosition(rows, now);
    if (position.dueToExpire > 0) {
      await tx.loyaltyPointsEntry.create({
        data: { organizationId, memberId, type: T.EXPIRE, points: -position.dueToExpire, reason: "Истёк срок жизни баллов", createdAt: now },
      });
      return pointsPosition([...rows, { id: "~expire", type: T.EXPIRE, points: -position.dueToExpire, expiresAt: null, createdAt: now }], now);
    }
    return position;
  }

  async settleOutside(organizationId: string, memberId: string) {
    await this.prisma.$transaction((tx) => this.settle(tx, organizationId, memberId));
  }

  // ── sales ─────────────────────────────────────────────────────────────────

  // Before the sale: is this member allowed to take part, and what do they hold?
  async prepareSale(organizationId: string, memberId: string): Promise<PreparedSaleLoyalty> {
    const settings = await this.getSettings(organizationId);
    if (!settings.enabled) throw new BadRequestException("Бонусная программа выключена");
    const member = await this.prisma.loyaltyMember.findFirst({ where: { id: memberId, organizationId } });
    if (!member) throw new NotFoundException("Клиент программы не найден");
    if (member.status !== LoyaltyMemberStatus.ACTIVE) {
      throw new BadRequestException("Клиент не участвует в программе (нет согласия или запись объединена)");
    }
    const available = (await this.balances(organizationId, [memberId])).get(memberId) ?? 0;
    return { memberId, settings, available };
  }

  // Inside the sale's transaction: spend, then earn on what was paid in money.
  async recordSale(
    tx: Prisma.TransactionClient,
    input: {
      user: AuthenticatedUser;
      prepared: PreparedSaleLoyalty;
      saleId: string;
      soldAt: Date;
      redeem: number;
      lines: SaleLoyaltyLine[];
    },
  ): Promise<{ pointsRedeemed: number; pointsEarned: number }> {
    const { user, prepared, saleId, soldAt } = input;
    const { memberId, settings } = prepared;
    const position = await this.settle(tx, user.organizationId, memberId, soldAt);
    const actor = { createdById: user.id, createdByName: user.fullName };

    const redeem = round2(input.redeem);
    if (redeem > 0) {
      if (redeem > position.available + 1e-9) {
        throw new BadRequestException(`Недостаточно баллов: на счёте ${position.available}, к списанию ${redeem}`);
      }
      await tx.loyaltyPointsEntry.create({
        data: { organizationId: user.organizationId, memberId, type: T.REDEEM, points: -redeem, saleId, ...actor, createdAt: soldAt },
      });
    }

    // «First purchase» = the first sale this member was attached to.
    const earlier = await tx.sale.count({ where: { loyaltyMemberId: memberId, id: { not: saleId } } });
    const rate = earlier === 0 ? settings.firstPurchaseEarnPercent : settings.earnPercent;
    const base = round2(input.lines.filter((l) => isPointsEarningLine({ ...l, quantity: l.quantity, unitPrice: 0 })).reduce((s, l) => s + l.subtotal, 0));
    const earned = loyaltyEarnPoints(base, rate);
    if (earned > 0) {
      await tx.loyaltyPointsEntry.create({
        data: {
          organizationId: user.organizationId,
          memberId,
          type: T.EARN,
          points: earned,
          expiresAt: addMonths(soldAt, settings.pointsLifetimeMonths),
          saleId,
          ratePercent: rate,
          ...actor,
          createdAt: soldAt,
        },
      });
    }
    return { pointsRedeemed: redeem, pointsEarned: earned };
  }

  // ── returns ───────────────────────────────────────────────────────────────
  // Cumulative, so several partial returns of one sale never drift by a тиын:
  // each return writes (what should have come back by now) − (what already did).

  async recordReturn(
    tx: Prisma.TransactionClient,
    input: {
      user: AuthenticatedUser;
      saleId: string;
      saleReturnId: string;
      memberId: string;
      saleLines: SaleLoyaltyLine[];
      // Quantities returned per product, this return included.
      returnedQtyByProduct: Map<string, number>;
      now: Date;
    },
  ): Promise<{ memberId: string; pointsRefunded: number; pointsReversed: number }> {
    const { user, saleId, saleReturnId, now } = input;
    const memberId = await this.finalMember(tx, input.memberId);
    const entries = await tx.loyaltyPointsEntry.findMany({ where: { saleId } });
    const previous = await tx.loyaltyPointsEntry.findMany({
      where: { saleReturn: { saleId }, type: { in: [T.REDEEM_REFUND, T.EARN_REVERSAL] } },
    });
    const sum = (rows: { points: Prisma.Decimal }[]) => rows.reduce((s, r) => s + r.points.toNumber(), 0);
    const redeemed = -sum(entries.filter((e) => e.type === T.REDEEM));
    const earned = sum(entries.filter((e) => e.type === T.EARN));
    if (redeemed <= 0 && earned <= 0) return { memberId, pointsRefunded: 0, pointsReversed: 0 };

    const byProduct = new Map<string, { qty: number; discount: number; earnBase: number }>();
    for (const l of input.saleLines) {
      const p = byProduct.get(l.productId) ?? { qty: 0, discount: 0, earnBase: 0 };
      p.qty += l.quantity;
      p.discount += l.loyaltyDiscount ?? 0;
      if (isPointsEarningLine({ ...l, unitPrice: 0 })) p.earnBase += l.subtotal;
      byProduct.set(l.productId, p);
    }
    let refundTarget = 0;
    let earnBaseReturned = 0;
    let earnBaseTotal = 0;
    for (const [productId, p] of byProduct) {
      const share = p.qty > 0 ? Math.min(1, (input.returnedQtyByProduct.get(productId) ?? 0) / p.qty) : 0;
      refundTarget += p.discount * share;
      earnBaseReturned += p.earnBase * share;
      earnBaseTotal += p.earnBase;
    }
    const alreadyRefunded = sum(previous.filter((e) => e.type === T.REDEEM_REFUND));
    const alreadyReversed = -sum(previous.filter((e) => e.type === T.EARN_REVERSAL));
    const refund = round2(Math.min(redeemed, round2(refundTarget)) - alreadyRefunded);
    const reverseTarget = earnBaseTotal > 0 ? floorToTiyn((earned * earnBaseReturned) / earnBaseTotal) : 0;
    const reverseWanted = round2(Math.min(earned, reverseTarget) - alreadyReversed);

    const settings = await this.getSettings(user.organizationId, tx);
    const position = await this.settle(tx, user.organizationId, memberId, now);
    const actor = { createdById: user.id, createdByName: user.fullName };
    if (refund > 0) {
      await tx.loyaltyPointsEntry.create({
        data: {
          organizationId: user.organizationId,
          memberId,
          type: T.REDEEM_REFUND,
          points: refund,
          expiresAt: addMonths(now, settings.pointsLifetimeMonths),
          saleId: null,
          saleReturnId,
          ...actor,
          createdAt: now,
        },
      });
    }
    // Points already spent elsewhere cannot be taken back; the balance never goes below zero.
    const reversible = round2(position.available + Math.max(0, refund));
    const reverse = round2(Math.min(reverseWanted, reversible));
    if (reverse > 0) {
      await tx.loyaltyPointsEntry.create({
        data: {
          organizationId: user.organizationId,
          memberId,
          type: T.EARN_REVERSAL,
          points: -reverse,
          saleReturnId,
          reason: reverse < reverseWanted ? "Часть начисленных баллов уже потрачена" : null,
          ...actor,
          createdAt: now,
        },
      });
    }
    return { memberId, pointsRefunded: Math.max(0, refund), pointsReversed: reverse };
  }

  // ── manual correction ─────────────────────────────────────────────────────

  async adjust(user: AuthenticatedUser, memberId: string, dto: { points: number; reason: string }): Promise<number> {
    const reason = dto.reason.trim();
    if (reason.length < 5) throw new BadRequestException("Укажите причину корректировки (не короче 5 символов)");
    const points = round2(dto.points);
    if (points === 0 || Math.round(dto.points * 100) !== dto.points * 100) {
      throw new BadRequestException("Укажите число баллов, не ноль, не больше двух знаков после запятой");
    }
    const member = await this.prisma.loyaltyMember.findFirst({ where: { id: memberId, organizationId: user.organizationId } });
    if (!member) throw new NotFoundException("Клиент не найден");
    if (member.status === LoyaltyMemberStatus.MERGED) {
      throw new BadRequestException("Эта запись объединена с другой — корректируйте основную");
    }
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.getSettings(user.organizationId, tx);
      const now = new Date();
      const before = await this.settle(tx, user.organizationId, memberId, now);
      if (points < 0 && -points > before.available + 1e-9) {
        throw new BadRequestException(`Нельзя списать больше, чем на счёте (${before.available})`);
      }
      await tx.loyaltyPointsEntry.create({
        data: {
          organizationId: user.organizationId,
          memberId,
          type: T.ADJUSTMENT,
          points,
          expiresAt: points > 0 ? addMonths(now, settings.pointsLifetimeMonths) : null,
          reason,
          createdById: user.id,
          createdByName: user.fullName,
          createdAt: now,
        },
      });
      const after = round2(before.available + points);
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltyPoints.adjust",
        entityType: "LoyaltyMember",
        entityId: memberId,
        before: { balance: before.available },
        after: { balance: after, points },
        reason,
      });
      return after;
    });
  }

  // ── merge ─────────────────────────────────────────────────────────────────
  // The duplicate's live points move to the primary record lot by lot, keeping
  // each lot's own expiry date — a merge neither extends nor shortens them.

  async transferOnMerge(tx: Prisma.TransactionClient, user: AuthenticatedUser, duplicateId: string, primaryId: string): Promise<number> {
    const now = new Date();
    await this.settle(tx, user.organizationId, primaryId, now);
    const position = await this.settle(tx, user.organizationId, duplicateId, now);
    if (position.available <= 0) return 0;
    const actor = { createdById: user.id, createdByName: user.fullName, createdAt: now };
    await tx.loyaltyPointsEntry.create({
      data: { organizationId: user.organizationId, memberId: duplicateId, type: T.MERGE_OUT, points: -position.available, reason: "Объединение записей", ...actor },
    });
    await tx.loyaltyPointsEntry.createMany({
      data: position.liveLots.map((lot) => ({
        organizationId: user.organizationId,
        memberId: primaryId,
        type: T.MERGE_IN,
        points: lot.remaining,
        expiresAt: lot.expiresAt,
        reason: "Объединение записей",
        ...actor,
      })),
    });
    return position.available;
  }

  // ── summary ───────────────────────────────────────────────────────────────

  async summary(organizationId: string, from: Date, to: Date): Promise<LoyaltySummaryDto> {
    const rows = await this.prisma.loyaltyPointsEntry.findMany({
      where: { organizationId },
      select: { id: true, memberId: true, type: true, points: true, expiresAt: true, createdAt: true },
    });
    const byMember = new Map<string, PointsRow[]>();
    let earned = 0;
    let redeemed = 0;
    let expired = 0;
    for (const r of rows) {
      const points = r.points.toNumber();
      const list = byMember.get(r.memberId) ?? [];
      list.push({ ...r, points });
      byMember.set(r.memberId, list);
      if (r.createdAt < from || r.createdAt > to) continue;
      if (r.type === T.EARN) earned += points;
      if (r.type === T.EARN_REVERSAL) earned += points;
      if (r.type === T.REDEEM) redeemed -= points;
      if (r.type === T.REDEEM_REFUND) redeemed -= points;
      if (r.type === T.EXPIRE) expired -= points;
    }
    const now = new Date();
    let outstanding = 0;
    let holders = 0;
    for (const list of byMember.values()) {
      const position = pointsPosition(list, now);
      // What expired but was never written off is gone all the same.
      outstanding += position.available;
      if (position.available > 0) holders += 1;
      // Expired but not yet written off (it is, the next time the member is touched).
      if (position.dueToExpire > 0 && to >= now) expired += position.dueToExpire;
    }
    return {
      pointsOutstanding: round2(outstanding),
      membersWithPoints: holders,
      pointsEarned: round2(earned),
      pointsRedeemed: round2(redeemed),
      pointsExpired: round2(expired),
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async rows(db: Db, memberId: string): Promise<PointsRow[]> {
    const rows = await db.loyaltyPointsEntry.findMany({
      where: { memberId },
      select: { id: true, type: true, points: true, expiresAt: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, points: r.points.toNumber() }));
  }

  // A return against a sale whose member was later merged credits the record it was merged into.
  private async finalMember(db: Db, memberId: string): Promise<string> {
    let id = memberId;
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
      const m = await db.loyaltyMember.findUnique({ where: { id }, select: { mergedIntoId: true } });
      if (!m?.mergedIntoId) return id;
      id = m.mergedIntoId;
    }
    return id;
  }
}
