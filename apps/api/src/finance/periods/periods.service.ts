import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, FinancialPeriodStatus as PrismaStatus } from "@prisma/client";
import {
  BalanceControlMode,
  CashSection,
  FinancialPeriodDto,
  FinancialPeriodStatus,
  FrozenReportInfoDto,
  PeriodDiagnosticsDto,
  PeriodPreflightDto,
  PeriodSnapshotDto,
  PeriodSnapshotPayloadDto,
  Role,
} from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthenticatedUser } from "../../auth/auth.types";
import { recordAudit } from "../../audit/audit";
import { monthKey, monthOf, monthOrdinal, monthRange, previousMonth } from "../../common/reporting-period";
import { FinanceService } from "../finance.service";
import { FinancialEventProjector } from "../events/projector";
import { checkEventInvariants } from "../events/invariants";
import { checkLedgerConsistency } from "../integrity/ledger-consistency";
import { AccountingPolicyService } from "../accounting-policy.service";
import { PeriodSectionBuilder } from "./section-builders";
import { PeriodGuard } from "./period-guard";

export const SNAPSHOT_SCHEMA_VERSION = 1;
// A close that started this long ago and never finished (a crash) may be taken over.
const STALE_CLOSING_MS = 10 * 60_000;

@Injectable()
export class FinancialPeriodsService {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
    private events: FinancialEventProjector = new FinancialEventProjector(prisma),
    private policy: AccountingPolicyService = new AccountingPolicyService(prisma),
    // Sections contributed by later modules (balance, inventory roll-forward…).
    private sections: PeriodSectionBuilder[] = [],
  ) {}

  registerSection(builder: PeriodSectionBuilder): void {
    this.sections.push(builder);
  }

  // ── reading ────────────────────────────────────────────────────────────

  // The last 18 months plus every month that has a row. A month with no row is OPEN.
  async list(organizationId: string): Promise<FinancialPeriodDto[]> {
    const now = monthOf(new Date());
    const rows = await this.prisma.financialPeriod.findMany({
      where: { organizationId },
      include: { closedBy: true },
    });
    const byKey = new Map(rows.map((r) => [monthKey(r.year, r.month), r]));
    const keys: { year: number; month: number }[] = [];
    let cursor = now;
    for (let i = 0; i < 18; i++) {
      keys.push(cursor);
      cursor = previousMonth(cursor.year, cursor.month);
    }
    for (const r of rows) {
      if (!keys.some((k) => k.year === r.year && k.month === r.month)) keys.push({ year: r.year, month: r.month });
    }
    keys.sort((a, b) => monthOrdinal(b.year, b.month) - monthOrdinal(a.year, a.month));
    const latestClosed = rows
      .filter((r) => r.status === PrismaStatus.CLOSED)
      .reduce((max, r) => Math.max(max, monthOrdinal(r.year, r.month)), 0);
    return keys.map(({ year, month }) => {
      const r = byKey.get(monthKey(year, month));
      const range = monthRange(year, month);
      return {
        year,
        month,
        from: range.start.toISOString(),
        to: range.end.toISOString(),
        status: (r?.status as FinancialPeriodStatus) ?? FinancialPeriodStatus.OPEN,
        version: r?.version ?? 1,
        closedAt: r?.closedAt ? r.closedAt.toISOString() : null,
        closedByName: r?.closedBy?.fullName ?? null,
        reopenedAt: r?.reopenedAt ? r.reopenedAt.toISOString() : null,
        reopenReason: r?.reopenReason ?? null,
        canReopen: r?.status === PrismaStatus.CLOSED && monthOrdinal(year, month) === latestClosed,
      };
    });
  }

  async preflight(organizationId: string, year: number, month: number): Promise<PeriodPreflightDto> {
    this.assertMonth(year, month);
    const blockers = await this.blockers(organizationId, year, month);
    const diagnostics = await this.diagnostics(organizationId, year, month);
    return { year, month, canClose: blockers.length === 0, blockers, diagnostics };
  }

  async getSnapshot(organizationId: string, year: number, month: number, version?: number): Promise<PeriodSnapshotDto> {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (!period) throw new NotFoundException("Период не закрывался");
    const snapshot = await this.prisma.periodSnapshot.findFirst({
      where: { periodId: period.id, ...(version ? { version } : { supersededAt: null }) },
      include: { createdBy: true },
      orderBy: { version: "desc" },
    });
    if (!snapshot) throw new NotFoundException("Снимок периода не найден");
    return this.toSnapshotDto(period.year, period.month, snapshot);
  }

  async listSnapshotVersions(organizationId: string, year: number, month: number): Promise<PeriodSnapshotDto[]> {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (!period) return [];
    const snapshots = await this.prisma.periodSnapshot.findMany({
      where: { periodId: period.id },
      include: { createdBy: true },
      orderBy: { version: "desc" },
    });
    return snapshots.map((s) => this.toSnapshotDto(year, month, s));
  }

  // The frozen version of a section of a CLOSED month, or null when the month
  // is not closed (the caller then computes live).
  async frozenSection<T>(
    organizationId: string,
    year: number,
    month: number,
    section: "pnl" | "cashFlow",
  ): Promise<{ data: T; info: FrozenReportInfoDto } | null> {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (!period || period.status !== PrismaStatus.CLOSED) return null;
    const snapshot = await this.prisma.periodSnapshot.findFirst({ where: { periodId: period.id, supersededAt: null } });
    if (!snapshot) return null;
    const payload = snapshot.payload as unknown as PeriodSnapshotPayloadDto;
    const data = payload[section] as T;
    return {
      data,
      info: { year, month, version: snapshot.version, closedAt: (period.closedAt ?? snapshot.createdAt).toISOString() },
    };
  }

  // If [from, to] is exactly one whole calendar month (within a minute), returns
  // that month — the only kind of range a snapshot can stand in for.
  matchWholeMonth(from: Date, to: Date): { year: number; month: number } | null {
    const { year, month } = monthOf(new Date(from.getTime() + 60_000));
    const range = monthRange(year, month);
    const near = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) <= 60_000;
    return near(from, range.start) && near(to, range.end) ? { year, month } : null;
  }

  // ── the guard ──────────────────────────────────────────────────────────

  async assertOpen(
    organizationId: string,
    date: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    return new PeriodGuard(this.prisma).assertOpen(organizationId, date, client);
  }

  // ── closing ────────────────────────────────────────────────────────────

  async close(user: AuthenticatedUser, year: number, month: number): Promise<PeriodSnapshotDto> {
    this.assertMonth(year, month);
    const organizationId = user.organizationId;
    const range = monthRange(year, month);

    const blockers = await this.blockers(organizationId, year, month);
    if (blockers.length > 0) throw new BadRequestException(blockers[0]);

    // 1. Take the period into CLOSING. Only one closer can win the flip.
    await this.prisma.financialPeriod.upsert({
      where: { organizationId_year_month: { organizationId, year, month } },
      create: { organizationId, year, month, periodStart: range.start, periodEnd: range.end },
      update: {},
    });
    const staleBefore = new Date(Date.now() - STALE_CLOSING_MS);
    const claimed = await this.prisma.financialPeriod.updateMany({
      where: {
        organizationId,
        year,
        month,
        OR: [
          { status: PrismaStatus.OPEN },
          { status: PrismaStatus.CLOSING, closingStartedAt: { lt: staleBefore } },
        ],
      },
      data: { status: PrismaStatus.CLOSING, closingStartedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ConflictException("Период уже закрыт или закрывается");
    }

    try {
      // 2. Compute the figures and the findings (outside any long transaction).
      const [payload, diagnostics, mode] = await Promise.all([
        this.buildPayload(organizationId, year, month),
        this.diagnostics(organizationId, year, month),
        this.policy.get(organizationId).then((p) => p.balanceControlMode.value),
      ]);
      // The policy decides whether findings stop a close. Unapproved = warn only.
      if (mode === BalanceControlMode.BLOCK && diagnostics.hasIssues) {
        throw new BadRequestException("Закрытие остановлено: контрольные проверки нашли расхождения (режим «блокировать»)");
      }

      // 3. Persist the snapshot and flip to CLOSED together.
      const created = await this.prisma.$transaction(async (tx) => {
        const period = await tx.financialPeriod.findUniqueOrThrow({
          where: { organizationId_year_month: { organizationId, year, month } },
        });
        const snapshot = await tx.periodSnapshot.create({
          data: {
            organizationId,
            periodId: period.id,
            version: period.version,
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            payload: payload as unknown as Prisma.InputJsonValue,
            diagnostics: diagnostics as unknown as Prisma.InputJsonValue,
            createdById: user.id,
          },
          include: { createdBy: true },
        });
        const flipped = await tx.financialPeriod.updateMany({
          where: { id: period.id, status: PrismaStatus.CLOSING },
          data: { status: PrismaStatus.CLOSED, closedAt: new Date(), closedById: user.id },
        });
        if (flipped.count !== 1) throw new ConflictException("Период изменён во время закрытия");
        await recordAudit(tx, {
          organizationId,
          actorId: user.id,
          action: "period.close",
          entityType: "FinancialPeriod",
          entityId: period.id,
          after: { year, month, version: period.version, hasIssues: diagnostics.hasIssues },
        });
        return snapshot;
      });
      return this.toSnapshotDto(year, month, created);
    } catch (err) {
      // Never leave a period stuck in CLOSING because something failed.
      await this.prisma.financialPeriod.updateMany({
        where: { organizationId, year, month, status: PrismaStatus.CLOSING },
        data: { status: PrismaStatus.OPEN, closingStartedAt: null },
      });
      throw err;
    }
  }

  // ── reopening ──────────────────────────────────────────────────────────

  // The single controlled way to change a closed month: owner only, latest
  // closed month only, with a reason, audited. The old snapshot stays as
  // history; the next close writes the next version.
  async reopen(user: AuthenticatedUser, year: number, month: number, reason: string): Promise<FinancialPeriodDto> {
    if (user.role !== Role.OWNER) {
      throw new ForbiddenException("Открыть закрытый период может только владелец");
    }
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestException("Укажите причину повторного открытия периода");
    }
    this.assertMonth(year, month);
    const organizationId = user.organizationId;

    await this.prisma.$transaction(async (tx) => {
      const period = await tx.financialPeriod.findUnique({
        where: { organizationId_year_month: { organizationId, year, month } },
      });
      if (!period || period.status !== PrismaStatus.CLOSED) {
        throw new BadRequestException("Этот период не закрыт");
      }
      const later = await tx.financialPeriod.findFirst({
        where: {
          organizationId,
          status: PrismaStatus.CLOSED,
          OR: [{ year: { gt: year } }, { year, month: { gt: month } }],
        },
      });
      if (later) {
        throw new BadRequestException("Сначала нужно открыть более поздний закрытый период — открыть можно только последний");
      }
      const now = new Date();
      const flipped = await tx.financialPeriod.updateMany({
        where: { id: period.id, status: PrismaStatus.CLOSED },
        data: {
          status: PrismaStatus.OPEN,
          version: { increment: 1 },
          reopenedAt: now,
          reopenedById: user.id,
          reopenReason: reason.trim(),
          closedAt: null,
          closedById: null,
        },
      });
      if (flipped.count !== 1) throw new ConflictException("Период уже открыт");
      await tx.periodSnapshot.updateMany({
        where: { periodId: period.id, supersededAt: null },
        data: { supersededAt: now, supersededReason: reason.trim() },
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "period.reopen",
        entityType: "FinancialPeriod",
        entityId: period.id,
        before: { status: PrismaStatus.CLOSED, version: period.version },
        after: { status: PrismaStatus.OPEN, version: period.version + 1 },
        reason: reason.trim(),
      });
    });

    const list = await this.list(organizationId);
    return list.find((p) => p.year === year && p.month === month)!;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private assertMonth(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException("Неверный период");
    }
  }

  private async blockers(organizationId: string, year: number, month: number): Promise<string[]> {
    const blockers: string[] = [];
    const range = monthRange(year, month);
    if (range.end.getTime() >= Date.now()) {
      blockers.push("Период ещё не закончился — закрыть можно только полностью прошедший месяц");
    }
    const existing = await this.prisma.financialPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (existing?.status === PrismaStatus.CLOSED) blockers.push("Период уже закрыт");
    if (existing?.status === PrismaStatus.CLOSING && existing.closingStartedAt && Date.now() - existing.closingStartedAt.getTime() < STALE_CLOSING_MS) {
      blockers.push("Период уже закрывается");
    }
    const laterClosed = await this.prisma.financialPeriod.findFirst({
      where: {
        organizationId,
        status: PrismaStatus.CLOSED,
        OR: [{ year: { gt: year } }, { year, month: { gt: month } }],
      },
    });
    if (laterClosed) blockers.push("Уже закрыт более поздний период — периоды закрываются по порядку");
    return blockers;
  }

  private async buildPayload(organizationId: string, year: number, month: number): Promise<PeriodSnapshotPayloadDto> {
    const range = monthRange(year, month);
    const [pnl, cashFlow, accountsReceivable, accountsPayable] = await Promise.all([
      this.finance.getProfitAndLoss(organizationId, range.start, range.end),
      this.finance.getCashFlow(organizationId, range.start, range.end),
      this.finance.getAccountsReceivable(organizationId),
      this.finance.getAccountsPayable(organizationId),
    ]);
    const payload: PeriodSnapshotPayloadDto = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      year,
      month,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      asOf: new Date().toISOString(),
      pnl,
      cashFlow,
      accountsReceivable,
      accountsPayable,
    };
    for (const builder of this.sections) {
      payload[builder.key] = await builder.build(organizationId, range.start, range.end);
    }
    return payload;
  }

  private async diagnostics(organizationId: string, year: number, month: number): Promise<PeriodDiagnosticsDto> {
    const range = monthRange(year, month);
    const [ledger, events, pnl] = await Promise.all([
      checkLedgerConsistency(this.prisma, organizationId),
      this.events.project(organizationId, { upTo: range.end }),
      this.finance.getProfitAndLoss(organizationId, range.start, range.end),
    ]);
    const invariants = checkEventInvariants(events);
    const unclassified = events.filter(
      (e) =>
        e.occurredAt >= range.start.toISOString() &&
        e.occurredAt <= range.end.toISOString() &&
        e.cash.some((c) => c.section === CashSection.UNCLASSIFIED),
    );
    const d: PeriodDiagnosticsDto = {
      stockDrifts: ledger.stock.drifts.length,
      cashDrifts: ledger.cash.drifts.length,
      eventCount: invariants.eventCount,
      incompleteEvents: invariants.incompleteEvents,
      eventInvariantViolations: invariants.violations.length,
      unclassifiedCashMovements: unclassified.length,
      unknownCostLines: pnl.costCoverage.unknownLines,
      hasIssues: false,
    };
    d.hasIssues =
      d.stockDrifts > 0 ||
      d.cashDrifts > 0 ||
      d.eventInvariantViolations > 0 ||
      d.incompleteEvents > 0 ||
      d.unclassifiedCashMovements > 0 ||
      d.unknownCostLines > 0;
    return d;
  }

  private toSnapshotDto = (
    year: number,
    month: number,
    s: {
      id: string;
      version: number;
      createdAt: Date;
      createdBy: { fullName: string };
      supersededAt: Date | null;
      supersededReason: string | null;
      payload: Prisma.JsonValue;
      diagnostics: Prisma.JsonValue;
    },
  ): PeriodSnapshotDto => ({
    id: s.id,
    year,
    month,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    createdByName: s.createdBy.fullName,
    supersededAt: s.supersededAt ? s.supersededAt.toISOString() : null,
    supersededReason: s.supersededReason,
    payload: s.payload as unknown as PeriodSnapshotPayloadDto,
    diagnostics: s.diagnostics as unknown as PeriodDiagnosticsDto,
  });
}
