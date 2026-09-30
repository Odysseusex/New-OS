import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostBehavior, FinanceCategoryDto, FinanceCategoryKind } from "@bakery-os/shared";
import { CreateFinanceCategoryDto } from "./dto/create-finance-category.dto";
import { UpdateFinanceCategoryDto } from "./dto/update-finance-category.dto";
import { auditFields, recordAudit } from "../audit/audit";

const CATEGORY_AUDIT_FIELDS = ["name", "kind", "costBehavior", "isActive"] as const;

@Injectable()
export class FinanceCategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    kind?: FinanceCategoryKind,
    includeArchived = false,
  ): Promise<FinanceCategoryDto[]> {
    const categories = await this.prisma.financeCategory.findMany({
      where: { organizationId, ...(kind ? { kind } : {}), ...(includeArchived ? {} : { isActive: true }) },
      orderBy: { name: "asc" },
    });
    return categories.map(this.toDto);
  }

  async create(
    organizationId: string,
    dto: CreateFinanceCategoryDto,
    actorId: string | null,
  ): Promise<FinanceCategoryDto> {
    const existing = await this.prisma.financeCategory.findUnique({
      where: { organizationId_name_kind: { organizationId, name: dto.name, kind: dto.kind } },
    });
    if (existing) {
      throw new ConflictException("Такая категория уже существует");
    }
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.financeCategory.create({ data: { ...dto, organizationId } });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: "financeCategory.create",
        entityType: "FinanceCategory",
        entityId: created.id,
        after: auditFields(created, CATEGORY_AUDIT_FIELDS),
      });
      return created;
    });
    return this.toDto(category);
  }

  async update(
    organizationId: string,
    categoryId: string,
    dto: UpdateFinanceCategoryDto,
    actorId: string | null,
  ): Promise<FinanceCategoryDto> {
    const category = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    if (dto.name !== category.name) {
      const existing = await this.prisma.financeCategory.findUnique({
        where: { organizationId_name_kind: { organizationId, name: dto.name, kind: category.kind } },
      });
      if (existing) {
        throw new ConflictException("Такая категория уже существует");
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.financeCategory.update({ where: { id: categoryId }, data: { name: dto.name } });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: "financeCategory.update",
        entityType: "FinanceCategory",
        entityId: categoryId,
        before: auditFields(category, CATEGORY_AUDIT_FIELDS),
        after: auditFields(saved, CATEGORY_AUDIT_FIELDS),
      });
      return saved;
    });
    return this.toDto(updated);
  }

  async setCostBehavior(
    organizationId: string,
    categoryId: string,
    costBehavior: CostBehavior,
    actorId: string | null,
  ): Promise<FinanceCategoryDto> {
    const category = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.financeCategory.update({ where: { id: categoryId }, data: { costBehavior } });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: "financeCategory.costBehavior",
        entityType: "FinanceCategory",
        entityId: categoryId,
        before: { costBehavior: category.costBehavior },
        after: { costBehavior },
      });
      return saved;
    });
    return this.toDto(updated);
  }

  async archive(organizationId: string, categoryId: string, actorId: string | null): Promise<FinanceCategoryDto> {
    return this.setActive(organizationId, categoryId, false, actorId);
  }

  async restore(organizationId: string, categoryId: string, actorId: string | null): Promise<FinanceCategoryDto> {
    return this.setActive(organizationId, categoryId, true, actorId);
  }

  async remove(organizationId: string, categoryId: string, actorId: string | null): Promise<{ deleted: true }> {
    const category = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, organizationId },
      include: { _count: { select: { expenses: true, cashMovements: true } } },
    });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    if (category._count.expenses > 0 || category._count.cashMovements > 0) {
      throw new BadRequestException(
        "Нельзя удалить категорию — она уже используется. Заархивируйте её вместо удаления.",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.financeCategory.delete({ where: { id: categoryId } });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: "financeCategory.delete",
        entityType: "FinanceCategory",
        entityId: categoryId,
        before: auditFields(category, CATEGORY_AUDIT_FIELDS),
      });
    });
    return { deleted: true };
  }

  private async setActive(
    organizationId: string,
    categoryId: string,
    isActive: boolean,
    actorId: string | null,
  ): Promise<FinanceCategoryDto> {
    const category = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.financeCategory.update({ where: { id: categoryId }, data: { isActive } });
      await recordAudit(tx, {
        organizationId,
        actorId,
        action: isActive ? "financeCategory.restore" : "financeCategory.archive",
        entityType: "FinanceCategory",
        entityId: categoryId,
        before: { isActive: category.isActive },
        after: { isActive },
      });
      return saved;
    });
    return this.toDto(updated);
  }

  private toDto = (category: {
    id: string;
    name: string;
    kind: string;
    isActive: boolean;
    costBehavior: string;
  }): FinanceCategoryDto => ({
    id: category.id,
    name: category.name,
    kind: category.kind as FinanceCategoryKind,
    isActive: category.isActive,
    costBehavior: category.costBehavior as CostBehavior,
  });
}
