import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostBehavior, FinanceCategoryDto, FinanceCategoryKind } from "@bakery-os/shared";
import { CreateFinanceCategoryDto } from "./dto/create-finance-category.dto";
import { UpdateFinanceCategoryDto } from "./dto/update-finance-category.dto";

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

  async create(organizationId: string, dto: CreateFinanceCategoryDto): Promise<FinanceCategoryDto> {
    const existing = await this.prisma.financeCategory.findUnique({
      where: { organizationId_name_kind: { organizationId, name: dto.name, kind: dto.kind } },
    });
    if (existing) {
      throw new ConflictException("Такая категория уже существует");
    }
    const category = await this.prisma.financeCategory.create({ data: { ...dto, organizationId } });
    return this.toDto(category);
  }

  async update(organizationId: string, categoryId: string, dto: UpdateFinanceCategoryDto): Promise<FinanceCategoryDto> {
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
    const updated = await this.prisma.financeCategory.update({ where: { id: categoryId }, data: { name: dto.name } });
    return this.toDto(updated);
  }

  async setCostBehavior(
    organizationId: string,
    categoryId: string,
    costBehavior: CostBehavior,
  ): Promise<FinanceCategoryDto> {
    const category = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    const updated = await this.prisma.financeCategory.update({ where: { id: categoryId }, data: { costBehavior } });
    return this.toDto(updated);
  }

  async archive(organizationId: string, categoryId: string): Promise<FinanceCategoryDto> {
    return this.setActive(organizationId, categoryId, false);
  }

  async restore(organizationId: string, categoryId: string): Promise<FinanceCategoryDto> {
    return this.setActive(organizationId, categoryId, true);
  }

  async remove(organizationId: string, categoryId: string): Promise<{ deleted: true }> {
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
    await this.prisma.financeCategory.delete({ where: { id: categoryId } });
    return { deleted: true };
  }

  private async setActive(organizationId: string, categoryId: string, isActive: boolean): Promise<FinanceCategoryDto> {
    const category = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    const updated = await this.prisma.financeCategory.update({ where: { id: categoryId }, data: { isActive } });
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
