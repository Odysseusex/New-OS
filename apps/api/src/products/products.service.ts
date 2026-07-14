import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductDto } from "@bakery-os/shared";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

const PRODUCT_INCLUDE = { categoryRef: true };

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: PRODUCT_INCLUDE,
      orderBy: { name: "asc" },
    });

    return products.map(this.toDto);
  }

  async create(organizationId: string, dto: CreateProductDto): Promise<ProductDto> {
    const existing = await this.prisma.product.findUnique({
      where: { organizationId_sku: { organizationId, sku: dto.sku } },
    });
    if (existing) {
      throw new ConflictException("Товар с таким артикулом уже существует");
    }

    if (dto.categoryId) {
      await this.assertCategoryExists(organizationId, dto.categoryId);
    }

    const product = await this.prisma.product.create({
      data: { ...dto, organizationId },
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
      },
      include: PRODUCT_INCLUDE,
    });

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
    };
  }
}
