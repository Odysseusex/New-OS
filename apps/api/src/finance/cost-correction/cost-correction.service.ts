import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CostCorrectionDto, CostCorrectionLineDto } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthenticatedUser } from "../../auth/auth.types";
import { recordAudit } from "../../audit/audit";
import { postLedgerSources } from "../../ledger/event-posting";
import { monthRange } from "../../common/reporting-period";
import { round2 } from "../../common/money";
import { replayCosts, ReplayResult } from "./replay";
import { HistoryClient, loadCostHistory } from "./cost-history";

// The month-end cost correction: the history (cost-history.ts) walked by
// method «Б» (replay.ts), laid out for a person, and recorded at close.
@Injectable()
export class CostCorrectionService {
  constructor(private prisma: PrismaService) {}

  async compute(organizationId: string, year: number, month: number, client: HistoryClient = this.prisma): Promise<{ result: ReplayResult; names: Map<string, { name: string; unit: string }> }> {
    const range = monthRange(year, month);
    const history = await loadCostHistory(client, organizationId, range.end);
    const result = replayCosts({ ...history, from: range.start.getTime(), to: range.end.getTime() });
    const names = new Map(history.products.map((p) => [p.id, { name: p.name, unit: p.unit as string }]));
    return { result, names };
  }

  // The recorded correction of the month (its latest version), else a preview.
  async forMonth(organizationId: string, year: number, month: number): Promise<CostCorrectionDto> {
    const stored = await this.prisma.costCorrection.findFirst({
      where: { organizationId, year, month },
      orderBy: { version: "desc" },
      include: { createdBy: { select: { fullName: true } } },
    });
    if (!stored) return this.preview(organizationId, year, month);
    const cogs = round2(stored.cogsAmount.toNumber());
    const loss = round2(stored.lossAmount.toNumber());
    return {
      year,
      month,
      status: "POSTED",
      version: stored.version,
      computedAt: stored.createdAt.toISOString(),
      postedByName: stored.createdBy.fullName,
      cogsCorrection: cogs,
      lossCorrection: loss,
      totalCorrection: round2(cogs + loss),
      unstampedLines: stored.unstampedLines,
      lines: stored.lines as unknown as CostCorrectionLineDto[],
    };
  }

  // Called by the month's close while the month is CLOSING (no business write
  // can be dated in it then): computes the correction, records it as the next
  // version for the month and lets the ledger post it — and reverse the
  // previous version's entry, whose event the new one replaces. Recorded even
  // when it is zero, so the month says it was checked.
  async record(user: AuthenticatedUser, year: number, month: number): Promise<CostCorrectionDto> {
    const organizationId = user.organizationId;
    const { result, names } = await this.compute(organizationId, year, month);
    const now = new Date();
    const dto = toDto(year, month, result, names, { status: "POSTED", version: null, computedAt: now, postedByName: user.fullName ?? null });
    const created = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.costCorrection.findMany({ where: { organizationId, year, month }, select: { id: true, version: true }, orderBy: { version: "desc" } });
      const version = (previous[0]?.version ?? 0) + 1;
      const row = await tx.costCorrection.create({
        data: {
          organizationId,
          year,
          month,
          version,
          cogsAmount: result.cogsCorrection,
          lossAmount: result.lossCorrection,
          unstampedLines: result.unstampedLines,
          lines: dto.lines as unknown as Prisma.InputJsonValue,
          createdById: user.id,
        },
      });
      await postLedgerSources(tx, {
        organizationId,
        actorId: user.id,
        scope: { costCorrectionIds: [row.id, ...previous.map((p) => p.id)] },
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "costCorrection.record",
        entityType: "CostCorrection",
        entityId: row.id,
        after: { year, month, version, cogsCorrection: result.cogsCorrection, lossCorrection: result.lossCorrection },
      });
      return row;
    });
    return { ...dto, version: created.version, computedAt: created.createdAt.toISOString() };
  }

  async preview(organizationId: string, year: number, month: number): Promise<CostCorrectionDto> {
    const { result, names } = await this.compute(organizationId, year, month);
    return toDto(year, month, result, names, { status: "PREVIEW", version: null, computedAt: new Date(), postedByName: null });
  }
}

// What a person reads: products whose figures moved, the largest first.
export function toDto(
  year: number,
  month: number,
  result: ReplayResult,
  names: Map<string, { name: string; unit: string }>,
  meta: { status: "PREVIEW" | "POSTED"; version: number | null; computedAt: Date; postedByName: string | null },
): CostCorrectionDto {
  const lines: CostCorrectionLineDto[] = result.products
    .map((p) => ({
      productId: p.productId,
      productName: names.get(p.productId)?.name ?? "—",
      unit: names.get(p.productId)?.unit ?? "",
      quantityOut: p.quantityOut,
      cogsStamped: p.cogs.stamped,
      cogsRecomputed: p.cogs.recomputed,
      lossStamped: p.losses.stamped,
      lossRecomputed: p.losses.recomputed,
      productionStamped: p.production.stamped,
      productionRecomputed: p.production.recomputed,
      difference: round2(p.cogs.recomputed - p.cogs.stamped + p.losses.recomputed - p.losses.stamped),
      openingAverage: p.openingAverage !== null ? Math.round(p.openingAverage * 10000) / 10000 : null,
      closingAverage: p.closingAverage !== null ? Math.round(p.closingAverage * 10000) / 10000 : null,
      unstampedLines: p.unstamped,
    }))
    .filter(
      (l) =>
        Math.abs(l.cogsRecomputed - l.cogsStamped) >= 0.01 ||
        Math.abs(l.lossRecomputed - l.lossStamped) >= 0.01 ||
        Math.abs(l.productionRecomputed - l.productionStamped) >= 0.01 ||
        l.unstampedLines > 0,
    )
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.productName.localeCompare(b.productName, "ru"));
  return {
    year,
    month,
    status: meta.status,
    version: meta.version,
    computedAt: meta.computedAt.toISOString(),
    postedByName: meta.postedByName,
    cogsCorrection: result.cogsCorrection,
    lossCorrection: result.lossCorrection,
    totalCorrection: round2(result.cogsCorrection + result.lossCorrection),
    unstampedLines: result.unstampedLines,
    lines,
  };
}
