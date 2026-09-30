import { BadRequestException, Injectable } from "@nestjs/common";
import { AccountingPolicy, Prisma } from "@prisma/client";
import {
  ACCOUNTING_POLICY_FIELDS,
  AccountingPolicyDto,
  AccountingPolicyField,
  NegativeStockPolicy,
  PolicySettingDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { UpdateAccountingPolicyDto } from "./dto/update-accounting-policy.dto";

type Approvals = Record<string, { approvedAt: string; approvedById: string }>;

// What the system does today when a setting has no approved value. Only
// settings the running code already depends on appear here; every other
// unapproved setting is reported as NOT_CONFIGURED.
const CURRENT_BEHAVIOR: Partial<Record<AccountingPolicyField, unknown>> = {
  negativeStockPolicy: NegativeStockPolicy.BLOCK,
};

@Injectable()
export class AccountingPolicyService {
  constructor(private prisma: PrismaService) {}

  // Read-only: an organization with no row simply has nothing approved yet.
  async get(organizationId: string): Promise<AccountingPolicyDto> {
    const row = await this.prisma.accountingPolicy.findUnique({ where: { organizationId } });
    return this.toDto(row);
  }

  async update(user: AuthenticatedUser, dto: UpdateAccountingPolicyDto): Promise<AccountingPolicyDto> {
    const requested = ACCOUNTING_POLICY_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(dto, field));
    if (requested.length === 0) {
      throw new BadRequestException("Не указано ни одной настройки для изменения");
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const current = await tx.accountingPolicy.findUnique({ where: { organizationId: user.organizationId } });
      const approvals: Approvals = { ...((current?.approvals as Approvals | null) ?? {}) };
      const now = new Date().toISOString();

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const data: Record<string, unknown> = {};
      for (const field of requested) {
        const next = (dto as unknown as Record<string, unknown>)[field] ?? null;
        const previous = current ? this.plain(current[field]) : null;
        if (previous === next) continue;
        before[field] = previous;
        after[field] = next;
        data[field] = next;
        if (next === null) delete approvals[field];
        else approvals[field] = { approvedAt: now, approvedById: user.id };
      }
      if (Object.keys(data).length === 0) {
        throw new BadRequestException("Эти значения уже установлены — изменений нет");
      }

      const row = await tx.accountingPolicy.upsert({
        where: { organizationId: user.organizationId },
        create: {
          organizationId: user.organizationId,
          ...data,
          approvals: approvals as Prisma.InputJsonValue,
          updatedById: user.id,
        },
        update: { ...data, approvals: approvals as Prisma.InputJsonValue, updatedById: user.id },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "accountingPolicy.update",
        entityType: "AccountingPolicy",
        entityId: row.id,
        before,
        after,
        reason: dto.reason,
      });
      return row;
    });

    return this.toDto(saved);
  }

  private plain(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Prisma.Decimal) return value.toNumber();
    return value;
  }

  private async toDto(row: AccountingPolicy | null): Promise<AccountingPolicyDto> {
    const approvals = ((row?.approvals as Approvals | null) ?? {}) as Approvals;
    const approverIds = [...new Set(Object.values(approvals).map((a) => a.approvedById))];
    const approvers = approverIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, fullName: true } })
      : [];
    const nameOf = new Map(approvers.map((u) => [u.id, u.fullName]));

    const setting = <T>(field: AccountingPolicyField): PolicySettingDto<T> => {
      const value = row ? (this.plain(row[field]) as T | null) : null;
      if (value !== null) {
        const approval = approvals[field];
        return {
          value,
          source: "APPROVED",
          approvedAt: approval?.approvedAt ?? null,
          approvedByName: approval ? (nameOf.get(approval.approvedById) ?? null) : null,
        };
      }
      const fallback = CURRENT_BEHAVIOR[field];
      return fallback !== undefined
        ? { value: fallback as T, source: "CURRENT_BEHAVIOR", approvedAt: null, approvedByName: null }
        : { value: null, source: "NOT_CONFIGURED", approvedAt: null, approvedByName: null };
    };

    return {
      negativeStockPolicy: setting("negativeStockPolicy"),
      writeOffPresentation: setting("writeOffPresentation"),
      returnScrapPresentation: setting("returnScrapPresentation"),
      balanceControlMode: setting("balanceControlMode"),
      capitalizationThreshold: setting("capitalizationThreshold"),
      depreciationMethod: setting("depreciationMethod"),
      depreciationUsefulLifeMonths: setting("depreciationUsefulLifeMonths"),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
}
