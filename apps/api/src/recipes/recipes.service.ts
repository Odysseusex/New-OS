import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RecipeDto, Unit } from "@bakery-os/shared";
import { CreateRecipeDto } from "./dto/create-recipe.dto";

@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string): Promise<RecipeDto[]> {
    const recipes = await this.prisma.recipe.findMany({
      where: { organizationId, isActive: true },
      include: { product: true, items: { include: { ingredientProduct: true } } },
      orderBy: { product: { name: "asc" } },
    });

    return recipes.map(this.toDto);
  }

  async create(organizationId: string, dto: CreateRecipeDto): Promise<RecipeDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, organizationId },
    });
    if (!product) {
      throw new NotFoundException("Товар не найден");
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
    };
  };
}
