import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CategoryDto } from "@bakery-os/shared";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<CategoryDto[]> {
    const categories = await this.prisma.category.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      productCount: c._count.products,
    }));
  }

  // The name is unique per organization whether the category is archived or
  // not, so a conflict can be with a row the screen is not showing. Saying
  // only "уже существует" then contradicts a list the user is looking at,
  // with nothing to act on — the archive is where they have to go, so the
  // message says so.
  private nameTakenError(existing: { name: string; isActive: boolean }): ConflictException {
    return new ConflictException(
      existing.isActive
        ? "Категория с таким названием уже существует"
        : `Категория «${existing.name}» есть в архиве. Восстановите её или выберите другое название.`,
    );
  }

  async create(organizationId: string, dto: CreateCategoryDto): Promise<CategoryDto> {
    const existing = await this.prisma.category.findUnique({
      where: { organizationId_name: { organizationId, name: dto.name } },
    });
    if (existing) {
      throw this.nameTakenError(existing);
    }

    const category = await this.prisma.category.create({ data: { ...dto, organizationId } });
    return { id: category.id, name: category.name, isActive: category.isActive, productCount: 0 };
  }

  async update(organizationId: string, categoryId: string, dto: UpdateCategoryDto): Promise<CategoryDto> {
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }

    if (dto.name !== category.name) {
      const existing = await this.prisma.category.findUnique({
        where: { organizationId_name: { organizationId, name: dto.name } },
      });
      if (existing) {
        throw this.nameTakenError(existing);
      }
    }

    const updated = await this.prisma.category.update({
      where: { id: categoryId },
      data: { name: dto.name },
      include: { _count: { select: { products: true } } },
    });
    return { id: updated.id, name: updated.name, isActive: updated.isActive, productCount: updated._count.products };
  }

  async archive(organizationId: string, categoryId: string): Promise<CategoryDto> {
    return this.setActive(organizationId, categoryId, false);
  }

  async restore(organizationId: string, categoryId: string): Promise<CategoryDto> {
    return this.setActive(organizationId, categoryId, true);
  }

  async remove(organizationId: string, categoryId: string): Promise<{ deleted: true }> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId },
      include: { _count: { select: { products: true } } },
    });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    if (category._count.products > 0) {
      throw new BadRequestException(
        "Нельзя удалить категорию — в ней есть товары. Перенесите их в другую категорию или заархивируйте.",
      );
    }

    await this.prisma.category.delete({ where: { id: categoryId } });
    return { deleted: true };
  }

  private async setActive(organizationId: string, categoryId: string, isActive: boolean): Promise<CategoryDto> {
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    const updated = await this.prisma.category.update({
      where: { id: categoryId },
      data: { isActive },
      include: { _count: { select: { products: true } } },
    });
    return { id: updated.id, name: updated.name, isActive: updated.isActive, productCount: updated._count.products };
  }
}
