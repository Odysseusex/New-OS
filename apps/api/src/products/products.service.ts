import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductDto, ProductType } from "@bakery-os/shared";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

const PRODUCT_INCLUDE = { categoryRef: true };

const SKU_PREFIX_BY_TYPE: Record<ProductType, string> = {
  [ProductType.RAW_MATERIAL]: "ING",
  [ProductType.FINISHED_GOOD]: "PRD",
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // Atomic per-organization counter (Prisma's `increment` is a single UPDATE
  // under the hood), so concurrent product creation without a manual SKU can
  // never collide — no retry loop needed.
  private async generateSku(organizationId: string, type: ProductType): Promise<string> {
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { productSkuSequence: { increment: 1 } },
    });
    return `${SKU_PREFIX_BY_TYPE[type]}-${String(org.productSkuSequence).padStart(6, "0")}`;
  }

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: PRODUCT_INCLUDE,
      orderBy: { name: "asc" },
    });

    return products.map(this.toDto);
  }

  async create(organizationId: string, dto: CreateProductDto): Promise<ProductDto> {
    let sku = dto.sku?.trim();
    if (sku) {
      const existing = await this.prisma.product.findUnique({
        where: { organizationId_sku: { organizationId, sku } },
      });
      if (existing) {
        throw new ConflictException("Товар с таким артикулом уже существует");
      }
    } else {
      sku = await this.generateSku(organizationId, dto.type);
    }

    if (dto.categoryId) {
      await this.assertCategoryExists(organizationId, dto.categoryId);
    }

    const product = await this.prisma.product.create({
      data: { ...dto, sku, organizationId },
      include: PRODUCT_INCLUDE,
    });

    return this.toDto(product);
  }

  async update(organizationId: string, productId: string, dto: UpdateProductDto): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }

    if (dto.sku && dto.sku !== product.sku) {
      const existing = await this.prisma.product.findUnique({
        where: { organizationId_sku: { organizationId, sku: dto.sku } },
      });
      if (existing) {
        throw new ConflictException("Товар с таким артикулом уже существует");
      }
    }

    if (dto.categoryId) {
      await this.assertCategoryExists(organizationId, dto.categoryId);
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.trackInventory !== undefined ? { trackInventory: dto.trackInventory } : {}),
        ...(dto.minQuantity !== undefined ? { minQuantity: dto.minQuantity } : {}),
      },
      include: PRODUCT_INCLUDE,
    });

    // minQuantity is meant to behave as one number per product, not per
    // location — propagate it to every location that already stocks this
    // product so an existing threshold doesn't stay stuck at the old value.
    if (dto.minQuantity !== undefined) {
      await this.prisma.stockLevel.updateMany({
        where: { productId },
        data: { minQuantity: dto.minQuantity },
      });
    }

    return this.toDto(updated);
  }

  async archive(organizationId: string, productId: string): Promise<ProductDto> {
    return this.setActive(organizationId, productId, false);
  }

  async restore(organizationId: string, productId: string): Promise<ProductDto> {
    return this.setActive(organizationId, productId, true);
  }

  async remove(organizationId: string, productId: string): Promise<{ deleted: true }> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }

    const [movements, saleItems, recipeItems, recipeOutput, purchaseItems, routeStopItems] = await Promise.all([
      this.prisma.stockMovement.count({ where: { productId } }),
      this.prisma.saleItem.count({ where: { productId } }),
      this.prisma.recipeItem.count({ where: { ingredientProductId: productId } }),
      this.prisma.recipe.count({ where: { productId } }),
      this.prisma.purchaseOrderItem.count({ where: { productId } }),
      this.prisma.routeStopItem.count({ where: { productId } }),
    ]);
    const usageCount = movements + saleItems + recipeItems + recipeOutput + purchaseItems + routeStopItems;
    if (usageCount > 0) {
      throw new BadRequestException(
        "Нельзя удалить товар — он уже используется в документах. Заархивируйте его вместо удаления.",
      );
    }

    await this.prisma.product.delete({ where: { id: productId } });
    return { deleted: true };
  }

  // Owner-only escape hatch for cleaning up duplicate/test products that
  // already made it into real documents (see `remove` above, which refuses
  // that case). Unlike `remove`, this strips every reference instead of
  // refusing when usageCount > 0:
  //  - StockLevel/StockMovement (productId), and — when this product has its
  //    own recipe — Recipe/RecipeItem/RecipeStage/RecipeStageParameter/
  //    RecipeRevision all cascade at the DB level (see schema.prisma).
  //  - Line items that reference this product from someone else's document
  //    (SaleItem, PurchaseOrderItem, InvoiceItem, RouteStopItem) or recipe
  //    (RecipeItem as ingredient) don't cascade and aren't nullable, so they
  //    are deleted explicitly — only that line disappears, the parent
  //    document/recipe stays intact.
  //  - Production batches that ran this product's own recipe are deleted
  //    outright (they only exist to produce the item being wiped); any stock
  //    movement they caused for *other* products (e.g. ingredient
  //    consumption) is preserved and just detached via batchId = null,
  //    since StockMovement is an append-only ledger for those products.
  async forceRemove(organizationId: string, productId: string): Promise<{ deleted: true }> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }

    await this.prisma.$transaction(async (tx) => {
      const ownRecipe = await tx.recipe.findUnique({ where: { productId }, select: { id: true } });
      if (ownRecipe) {
        const batches = await tx.productionBatch.findMany({
          where: { recipeId: ownRecipe.id },
          select: { id: true },
        });
        const batchIds = batches.map((b) => b.id);
        if (batchIds.length > 0) {
          await tx.stockMovement.updateMany({
            where: { batchId: { in: batchIds } },
            data: { batchId: null },
          });
          await tx.productionBatch.deleteMany({ where: { id: { in: batchIds } } });
        }
      }

      await tx.saleItem.deleteMany({ where: { productId } });
      await tx.recipeItem.deleteMany({ where: { ingredientProductId: productId } });
      await tx.purchaseOrderItem.deleteMany({ where: { productId } });
      await tx.invoiceItem.deleteMany({ where: { productId } });
      await tx.routeStopItem.deleteMany({ where: { productId } });

      await tx.product.delete({ where: { id: productId } });
    });

    return { deleted: true };
  }

  private async setActive(organizationId: string, productId: string, isActive: boolean): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { isActive },
      include: PRODUCT_INCLUDE,
    });
    return this.toDto(updated);
  }

  private async assertCategoryExists(organizationId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
  }

  private toDto(product: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    type: string;
    categoryId: string | null;
    categoryRef: { name: string } | null;
    price: { toNumber: () => number };
    isActive: boolean;
    trackInventory: boolean;
    minQuantity: { toNumber: () => number };
  }): ProductDto {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit as ProductDto["unit"],
      type: product.type as ProductDto["type"],
      categoryId: product.categoryId,
      categoryName: product.categoryRef?.name ?? null,
      price: product.price.toNumber(),
      isActive: product.isActive,
      trackInventory: product.trackInventory,
      minQuantity: product.minQuantity.toNumber(),
    };
  }
}
