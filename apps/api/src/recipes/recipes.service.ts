import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductType, RecipeDto, Unit } from "@bakery-os/shared";
import { CreateRecipeDto } from "./dto/create-recipe.dto";

@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<RecipeDto[]> {
    const recipes = await this.prisma.recipe.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: { product: true, items: { include: { ingredientProduct: true } } },
      orderBy: { product: { name: "asc" } },
    });

    return recipes.map(this.toDto);
  }

  async archive(organizationId: string, recipeId: string): Promise<RecipeDto> {
    return this.setActive(organizationId, recipeId, false);
  }

  async restore(organizationId: string, recipeId: string): Promise<RecipeDto> {
    return this.setActive(organizationId, recipeId, true);
  }

  async remove(organizationId: string, recipeId: string): Promise<{ deleted: true }> {
    const recipe = await this.prisma.recipe.findFirst({ where: { id: recipeId, organizationId } });
    if (!recipe) {
      throw new NotFoundException("Рецептура не найдена");
    }
    const batchesCount = await this.prisma.productionBatch.count({ where: { recipeId } });
    if (batchesCount > 0) {
      throw new BadRequestException(
        "Нельзя удалить рецептуру — по ней уже были производственные задания. Заархивируйте её вместо удаления.",
      );
    }

    await this.prisma.recipe.delete({ where: { id: recipeId } });
    return { deleted: true };
  }

  private async setActive(organizationId: string, recipeId: string, isActive: boolean): Promise<RecipeDto> {
    const recipe = await this.prisma.recipe.findFirst({ where: { id: recipeId, organizationId } });
    if (!recipe) {
      throw new NotFoundException("Рецептура не найдена");
    }
    const updated = await this.prisma.recipe.update({
      where: { id: recipeId },
      data: { isActive },
      include: { product: true, items: { include: { ingredientProduct: true } } },
    });
    return this.toDto(updated);
  }

  async create(organizationId: string, dto: CreateRecipeDto): Promise<RecipeDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, organizationId },
    });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }
    if (product.type !== ProductType.FINISHED_GOOD) {
      throw new BadRequestException("Рецептуру можно создать только для готовой продукции");
    }

    const existingRecipe = await this.prisma.recipe.findUnique({ where: { productId: dto.productId } });
    if (existingRecipe) {
      throw new ConflictException("У этого товара уже есть рецептура");
    }

    if (dto.items.some((item) => item.ingredientProductId === dto.productId)) {
      throw new BadRequestException("Товар не может быть ингредиентом самого себя");
    }

    const ingredientIds = dto.items.map((i) => i.ingredientProductId);
    const ingredients = await this.prisma.product.findMany({
      where: { id: { in: ingredientIds }, organizationId },
    });
    if (ingredients.length !== new Set(ingredientIds).size) {
      throw new BadRequestException("Один или несколько ингредиентов не найдены");
    }
    if (ingredients.some((i) => i.type !== ProductType.RAW_MATERIAL)) {
      throw new BadRequestException("В качестве ингредиентов можно использовать только сырьё");
    }

    const recipe = await this.prisma.recipe.create({
      data: {
        organizationId,
        productId: dto.productId,
        yieldQuantity: dto.yieldQuantity,
        items: {
          create: dto.items.map((item) => ({
            ingredientProductId: item.ingredientProductId,
            quantity: item.quantity,
          })),
        },
      },
      include: { product: true, items: { include: { ingredientProduct: true } } },
    });

    return this.toDto(recipe);
  }

  private toDto = (recipe: {
    id: string;
    productId: string;
    product: { name: string; unit: string; price: { toNumber: () => number } };
    yieldQuantity: { toNumber: () => number };
    isActive: boolean;
    items: {
      id: string;
      ingredientProductId: string;
      ingredientProduct: { name: string; unit: string; price: { toNumber: () => number } };
      quantity: { toNumber: () => number };
    }[];
  }): RecipeDto => {
    const yieldQuantity = recipe.yieldQuantity.toNumber();
    const totalIngredientCost = recipe.items.reduce(
      (sum, item) => sum + item.quantity.toNumber() * item.ingredientProduct.price.toNumber(),
      0,
    );
    const unitCost = yieldQuantity > 0 ? totalIngredientCost / yieldQuantity : 0;
    const productPrice = recipe.product.price.toNumber();
    const marginPercent = productPrice > 0 ? ((productPrice - unitCost) / productPrice) * 100 : null;

    return {
      id: recipe.id,
      productId: recipe.productId,
      productName: recipe.product.name,
      productUnit: recipe.product.unit as Unit,
      productPrice,
      yieldQuantity,
      items: recipe.items.map((item) => ({
        id: item.id,
        ingredientProductId: item.ingredientProductId,
        ingredientProductName: item.ingredientProduct.name,
        unit: item.ingredientProduct.unit as Unit,
        quantity: item.quantity.toNumber(),
      })),
      unitCost,
      marginPercent,
      isActive: recipe.isActive,
    };
  };
}
