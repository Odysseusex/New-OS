import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CategoryDto,
  PRODUCT_TYPE_LABELS_RU,
  ProductType,
  STANDARD_CATEGORY_CATALOG,
  normalizeCategoryName,
  StandardCatalogBranchDto,
  StandardCatalogResultDto,
} from "@bakery-os/shared";
import { audited } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

type CategoryRow = {
  id: string;
  organizationId: string;
  name: string;
  // Prisma's enum and the shared one are the same strings but different types.
  type: ProductType | `${ProductType}` | null;
  parentId: string | null;
  sortOrder: number | null;
  isActive: boolean;
};

// Product classification: TYPE → Category → Subcategory → Product.
//
// The tree is two levels deep on purpose (a subcategory cannot have children),
// a category belongs to exactly one product type, and a subcategory always has
// its parent's. It is a management dimension: nothing here touches a recipe, a
// cost or an accounting figure.
@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<CategoryDto[]> {
    // Counts come from every category (archived ones too), so a parent's total
    // does not shrink just because a subcategory is hidden.
    const [all, grouped] = await Promise.all([
      this.prisma.category.findMany({
        where: { organizationId },
        // The till reads this order straight into its row of tabs, so the
        // cashier's own ordering has to win over the alphabet. Unplaced
        // categories are NULL and go last — the whole reason the column is
        // nullable, since a default 0 would have outranked «поставь хлеб
        // первым». Name second, so the unplaced group stays alphabetical.
        orderBy: [{ sortOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }],
      }),
      this.prisma.product.groupBy({
        by: ["categoryId"],
        where: { organizationId, categoryId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const own = new Map(grouped.map((g) => [g.categoryId as string, g._count._all]));
    const childTotals = new Map<string, number>();
    for (const c of all) {
      if (c.parentId) childTotals.set(c.parentId, (childTotals.get(c.parentId) ?? 0) + (own.get(c.id) ?? 0));
    }
    return all
      .filter((c) => includeArchived || c.isActive)
      .map((c) => this.toDto(c, own.get(c.id) ?? 0, (own.get(c.id) ?? 0) + (childTotals.get(c.id) ?? 0)));
  }

  // The category and every subcategory under it — what a filter on a parent
  // means. Throws if the category is not this organization's.
  async idsWithDescendants(organizationId: string, categoryId: string): Promise<string[]> {
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, organizationId }, select: { id: true } });
    if (!category) throw new NotFoundException("Категория не найдена");
    const children = await this.prisma.category.findMany({ where: { organizationId, parentId: categoryId }, select: { id: true } });
    return [category.id, ...children.map((c) => c.id)];
  }

  // The name is unique among its siblings (and top-level names across the whole
  // organization) whether the category is archived or not, so a conflict can be
  // with a row the screen is not showing. Saying only "уже существует" then
  // contradicts a list the user is looking at, with nothing to act on — the
  // archive is where they have to go, so the message says so.
  private nameTakenError(existing: { name: string; isActive: boolean }): ConflictException {
    return new ConflictException(
      existing.isActive
        ? "Категория с таким названием уже существует"
        : `Категория «${existing.name}» есть в архиве. Восстановите её или выберите другое название.`,
    );
  }

  private async assertNameFree(organizationId: string, parentId: string | null, name: string, exceptId?: string) {
    const existing = await this.prisma.category.findFirst({
      where: { organizationId, parentId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (existing) throw this.nameTakenError(existing);
  }

  // A parent must be this organization's, active, typed, and itself top-level —
  // which is the whole of the depth rule — and a category cannot be nested under
  // something below it.
  private async resolveParent(organizationId: string, parentId: string, self?: CategoryRow): Promise<CategoryRow> {
    const parent = await this.prisma.category.findFirst({ where: { id: parentId, organizationId } });
    if (!parent) throw new NotFoundException("Родительская категория не найдена");
    if (self && parent.id === self.id) {
      throw new BadRequestException("Категорию нельзя вложить в саму себя");
    }
    if (self && parent.parentId === self.id) {
      throw new BadRequestException("Нельзя вложить категорию в её же подкатегорию");
    }
    if (parent.parentId !== null) {
      throw new BadRequestException("Подкатегорию нельзя вложить в подкатегорию — допустимо два уровня: категория и подкатегория");
    }
    if (!parent.isActive) {
      throw new BadRequestException(`Категория «${parent.name}» в архиве — сначала восстановите её`);
    }
    if (parent.type === null) {
      throw new BadRequestException(`Сначала задайте тип у категории «${parent.name}»`);
    }
    return parent;
  }

  async create(organizationId: string, dto: CreateCategoryDto): Promise<CategoryDto> {
    let type: ProductType;
    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.resolveParent(organizationId, dto.parentId);
      if (dto.type && dto.type !== parent.type) {
        throw new BadRequestException("Подкатегория должна быть того же типа, что и её категория");
      }
      type = parent.type as ProductType;
      parentId = parent.id;
    } else {
      if (!dto.type) throw new BadRequestException("Выберите тип товара для категории");
      type = dto.type;
    }
    await this.assertNameFree(organizationId, parentId, dto.name);

    try {
      const category = await this.prisma.category.create({
        data: { organizationId, name: dto.name, type, parentId, sortOrder: dto.sortOrder ?? null },
      });
      return this.toDto(category, 0, 0);
    } catch (error) {
      // Two people adding the same name at once: the unique index is the real guard.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Категория с таким названием уже существует");
      }
      throw error;
    }
  }

  async update(organizationId: string, categoryId: string, dto: UpdateCategoryDto, actorId: string | null = null): Promise<CategoryDto> {
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }

    // Where it will sit after this change.
    let parentId = category.parentId;
    let type = category.type as ProductType | null;
    if (dto.parentId !== undefined && dto.parentId !== category.parentId) {
      if (dto.parentId === null) {
        parentId = null;
      } else {
        const parent = await this.resolveParent(organizationId, dto.parentId, category);
        const childCount = await this.prisma.category.count({ where: { organizationId, parentId: category.id } });
        if (childCount > 0) {
          throw new BadRequestException("У категории есть подкатегории — вложить её нельзя: допустимо два уровня");
        }
        if (category.type !== null && category.type !== parent.type) {
          throw new BadRequestException("Тип категории и тип родителя не совпадают");
        }
        parentId = parent.id;
        // An untyped legacy category takes its parent's type — but only when what
        // it already holds agrees with it (checked just below).
        type = parent.type as ProductType;
      }
    }

    if (dto.type !== undefined && dto.type !== type) {
      if (type !== null) throw new BadRequestException("Тип категории изменить нельзя");
      type = dto.type;
    }
    // Giving a legacy category its type is only honest if everything already in
    // it is of that type: nothing is re-typed behind anyone's back.
    if (category.type === null && type !== null) {
      const foreign = await this.prisma.product.count({ where: { categoryId: category.id, type: { not: type } } });
      if (foreign > 0) {
        throw new BadRequestException(
          `В категории есть товары другого типа (${foreign}). Перенесите их, прежде чем задавать тип «${PRODUCT_TYPE_LABELS_RU[type]}».`,
        );
      }
    }

    if (dto.name !== category.name || parentId !== category.parentId) {
      await this.assertNameFree(organizationId, parentId, dto.name, category.id);
    }

    const updated = await audited(
      this.prisma,
      { organizationId, actorId, action: "category.update", entityType: "Category", entityId: categoryId, before: { name: category.name, sortOrder: category.sortOrder, type: category.type, parentId: category.parentId } },
      async (tx) => {
        const saved = await tx.category.update({
          where: { id: categoryId },
          data: {
            name: dto.name,
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(type !== category.type ? { type } : {}),
            ...(parentId !== category.parentId ? { parentId } : {}),
          },
        });
        return { result: saved, after: { name: saved.name, sortOrder: saved.sortOrder, type: saved.type, parentId: saved.parentId } };
      },
    );
    return this.dtoFor(updated);
  }

  async archive(organizationId: string, categoryId: string, actorId: string | null = null): Promise<CategoryDto> {
    return this.setActive(organizationId, categoryId, false, actorId);
  }

  async restore(organizationId: string, categoryId: string, actorId: string | null = null): Promise<CategoryDto> {
    return this.setActive(organizationId, categoryId, true, actorId);
  }

  async remove(organizationId: string, categoryId: string, actorId: string | null = null): Promise<{ deleted: true }> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId },
      include: { _count: { select: { products: true, children: true, promotionRules: true } } },
    });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    if (category._count.products > 0) {
      throw new BadRequestException(
        "Нельзя удалить категорию — в ней есть товары. Перенесите их в другую категорию или заархивируйте.",
      );
    }
    if (category._count.children > 0) {
      throw new BadRequestException(
        "Нельзя удалить категорию — в ней есть подкатегории. Удалите или перенесите их, либо заархивируйте категорию.",
      );
    }
    if (category._count.promotionRules > 0) {
      throw new BadRequestException("Нельзя удалить категорию — она используется в правилах акций. Заархивируйте её.");
    }

    await audited(
      this.prisma,
      { organizationId, actorId, action: "category.delete", entityType: "Category", entityId: categoryId, before: { name: category.name, sortOrder: category.sortOrder, type: category.type, parentId: category.parentId } },
      async (tx) => {
        await tx.category.delete({ where: { id: categoryId } });
        return { result: true };
      },
    );
    return { deleted: true };
  }

  // ── the standard catalogue ───────────────────────────────────────────────
  //
  // ADDS top-level categories only (no subcategories — a classification creates
  // those where needed). A catalogue name matches an existing top-level category
  // ignoring case and a trailing «…» (see normalizeCategoryName); a match of the
  // same type is reused untouched. A match of another type, with no type, or in
  // the archive leaves that category alone and is reported. Nothing existing is
  // renamed, moved or retyped, and no product is touched.

  async previewStandardCatalog(organizationId: string): Promise<StandardCatalogResultDto> {
    const { result } = await this.planStandardCatalog(organizationId);
    return result;
  }

  async applyStandardCatalog(organizationId: string, actorId: string | null): Promise<StandardCatalogResultDto> {
    const { result, toCreate } = await this.planStandardCatalog(organizationId);
    return audited(
      this.prisma,
      { organizationId, actorId, action: "category.seedStandard", entityType: "Category", entityId: "standard-catalog", before: null },
      async (tx) => {
        for (const item of toCreate) {
          await tx.category.create({ data: { organizationId, name: item.name, type: item.type, parentId: null } });
        }
        const applied = { ...result, applied: true };
        return { result: applied, after: { categoriesCreated: applied.categoriesCreated } };
      },
    );
  }

  private async planStandardCatalog(organizationId: string) {
    const tops = await this.prisma.category.findMany({ where: { organizationId, parentId: null } });
    const byKey = new Map<string, typeof tops>();
    for (const c of tops) {
      const key = normalizeCategoryName(c.name);
      byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
    const toCreate: { type: ProductType; name: string }[] = [];
    const branches: StandardCatalogBranchDto[] = [];
    for (const item of STANDARD_CATEGORY_CATALOG) {
      const matches = byKey.get(normalizeCategoryName(item.name)) ?? [];
      // Prefer a usable match (same type, active), then the exact spelling.
      const usable = matches.find((c) => c.type === item.type && c.isActive && c.name === item.name) ?? matches.find((c) => c.type === item.type && c.isActive);
      const existing = usable ?? matches[0];
      if (!existing) {
        toCreate.push(item);
        branches.push({ type: item.type, category: item.name, categoryStatus: "created", existingName: null });
      } else if (usable) {
        branches.push({ type: item.type, category: item.name, categoryStatus: "reused", existingName: existing.name !== item.name ? existing.name : null });
      } else {
        branches.push({ type: item.type, category: item.name, categoryStatus: "skipped", existingName: existing.name });
      }
    }
    return { toCreate, result: { applied: false, categoriesCreated: toCreate.length, branches } satisfies StandardCatalogResultDto };
  }

  // One category as the screens need it, with its own counts read fresh.
  private async dtoFor(category: CategoryRow): Promise<CategoryDto> {
    const [own, children] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: category.id } }),
      this.prisma.category.findMany({ where: { parentId: category.id }, select: { id: true } }),
    ]);
    const below = children.length
      ? await this.prisma.product.count({ where: { categoryId: { in: children.map((c) => c.id) } } })
      : 0;
    return this.toDto(category, own, own + below);
  }

  private toDto(category: CategoryRow, productCount: number, totalProductCount: number): CategoryDto {
    return {
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      productCount,
      type: category.type as ProductType | null,
      parentId: category.parentId,
      totalProductCount,
    };
  }

  // Archiving a category archives the subcategories under it too (they would
  // otherwise hang from something hidden); restoring one needs its parent to be
  // active, and does NOT bring its subcategories back — that is a separate choice.
  private async setActive(organizationId: string, categoryId: string, isActive: boolean, actorId: string | null = null): Promise<CategoryDto> {
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    if (isActive && category.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: category.parentId } });
      if (parent && !parent.isActive) {
        throw new BadRequestException(`Сначала восстановите категорию «${parent.name}»`);
      }
    }
    const updated = await audited(
      this.prisma,
      { organizationId, actorId, action: isActive ? "category.restore" : "category.archive", entityType: "Category", entityId: categoryId, before: { isActive: category.isActive } },
      async (tx) => {
        const saved = await tx.category.update({ where: { id: categoryId }, data: { isActive } });
        let cascaded = 0;
        if (!isActive) {
          cascaded = (await tx.category.updateMany({ where: { organizationId, parentId: categoryId, isActive: true }, data: { isActive: false } })).count;
        }
        return { result: saved, after: { isActive: saved.isActive, subcategoriesArchived: cascaded } };
      },
    );
    return this.dtoFor(updated);
  }
}
