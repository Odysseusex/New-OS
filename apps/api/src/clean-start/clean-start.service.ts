import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CLEAN_START_BACKUP_HOURS,
  CLEAN_START_CONFIRMATION,
  CleanStartGroupDto,
  CleanStartPreviewDto,
  CleanStartResultDto,
  Role,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import {
  CLEAN_START_DELETES,
  CLEAN_START_KEEP_GROUPS,
  CLEAN_START_REMOVE_GROUPS,
  CLEAN_START_REMOVED_TABLES,
  CLEAN_START_RESETS,
} from "./clean-start-plan";

// «Начать учёт с чистого листа» (owner's decision, 04.11.2026: two months of invented
// sales, receipts and money made every report a lie). Deletes the organization's whole
// transactional history in ONE transaction and keeps its reference data; opening
// balances are entered afterwards (stocktake, account balances, «Запустить» in Финансы).
// Preview writes nothing. The reset needs the owner, a backup downloaded within the last
// day and the confirmation word, and is itself recorded in the audit log, which stays.
@Injectable()
export class CleanStartService {
  private readonly logger = new Logger(CleanStartService.name);

  constructor(private prisma: PrismaService) {}

  async preview(user: AuthenticatedUser): Promise<CleanStartPreviewDto> {
    this.assertOwner(user);
    const [remove, keep, lastBackupAt] = await Promise.all([
      this.count(this.prisma, user.organizationId, CLEAN_START_REMOVE_GROUPS),
      this.count(this.prisma, user.organizationId, CLEAN_START_KEEP_GROUPS),
      this.lastBackup(user.organizationId),
    ]);
    return { remove, keep, lastBackupAt: lastBackupAt?.toISOString() ?? null, backupFresh: this.fresh(lastBackupAt) };
  }

  async execute(user: AuthenticatedUser, confirmation: string): Promise<CleanStartResultDto> {
    this.assertOwner(user);
    if ((confirmation ?? "").trim().toUpperCase() !== CLEAN_START_CONFIRMATION) {
      throw new BadRequestException(`Для подтверждения введите слово «${CLEAN_START_CONFIRMATION}»`);
    }
    if (!this.fresh(await this.lastBackup(user.organizationId))) {
      throw new BadRequestException("Сначала скачайте резервную копию данных (Настройки → «Резервная копия данных») — не раньше чем за сутки до очистки");
    }
    const organizationId = user.organizationId;
    const removed = await this.prisma.$transaction(
      async (tx) => {
        const before = await this.count(tx, organizationId, CLEAN_START_REMOVE_GROUPS);
        for (const sql of CLEAN_START_DELETES) await tx.$executeRawUnsafe(sql, organizationId);
        for (const sql of CLEAN_START_RESETS) await tx.$executeRawUnsafe(sql, organizationId);
        // Nothing may be left behind: if a table still holds rows, everything rolls back.
        for (const table of CLEAN_START_REMOVED_TABLES) {
          const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}" WHERE "organizationId" = $1`, organizationId);
          if (Number(rows[0].n) > 0) throw new Error(`clean start left rows in ${table}`);
        }
        await recordAudit(tx, {
          organizationId,
          actorId: user.id,
          action: "organization.cleanStart",
          entityType: "Organization",
          entityId: organizationId,
          before: Object.fromEntries(before.map((g) => [g.label, g.count])) as Prisma.InputJsonValue,
          reason: "Начать учёт с чистого листа",
        });
        return before;
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
    this.logger.warn(`Clean start for organization ${organizationId} by ${user.id}`);
    return { removed, at: new Date().toISOString() };
  }

  private assertOwner(user: AuthenticatedUser) {
    if (user.role !== Role.OWNER) throw new ForbiddenException("Только для собственника");
  }

  private async count(client: Prisma.TransactionClient | PrismaService, organizationId: string, groups: { label: string; table: string }[]): Promise<CleanStartGroupDto[]> {
    const out: CleanStartGroupDto[] = [];
    for (const g of groups) {
      const rows = await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${g.table}" WHERE "organizationId" = $1`, organizationId);
      out.push({ label: g.label, count: Number(rows[0].n) });
    }
    return out;
  }

  private async lastBackup(organizationId: string): Promise<Date | null> {
    const last = await this.prisma.auditLog.findFirst({
      where: { organizationId, action: "dataExport.download" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return last?.createdAt ?? null;
  }

  private fresh(at: Date | null): boolean {
    return !!at && Date.now() - at.getTime() <= CLEAN_START_BACKUP_HOURS * 3_600_000;
  }
}
