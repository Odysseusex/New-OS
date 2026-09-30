import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AUDIT_VIEW_ROLES, AuditLogEntryDto } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ListAuditQueryDto } from "./dto/list-audit-query.dto";

// Read-only by design: the log has no create/update/delete route. Entries are
// written only by recordAudit() inside the transaction of the change itself.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...AUDIT_VIEW_ROLES)
@Controller("audit")
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAuditQueryDto): Promise<AuditLogEntryDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: user.organizationId,
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: { actor: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(query.limit ?? 100, 500),
      skip: query.offset ?? 0,
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorId: r.actorId,
      actorName: r.actor?.fullName ?? null,
      before: r.before,
      after: r.after,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
