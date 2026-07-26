import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductType, RecipeDto, Unit } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateRecipeDto } from "./dto/create-recipe.dto";
import { UpdateRecipeDto } from "./dto/update-recipe.dto";

const RECIPE_INCLUDE = {
  product: true,
  items: { include: { ingredientProduct: true } },
  steps: { orderBy: { sequence: "asc" as const } },
  revisions: { orderBy: { changedAt: "desc" as const }, include: { changedBy: true } },
};

// Ingredient units that can be summed into a dough weight. PCS can't be
// converted without knowing an average piece weight, so items in PCS are
// excluded from the sum rather than guessed at.
const KG_CONVERSION_FACTOR: Partial<Record<Unit, number>> = {
  [Unit.KG]: 1,
  [Unit.G]: 0.001,
  [Unit.L]: 1, // approximation: 1L water ≈ 1kg, standard baker's shorthand
};

@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<RecipeDto[]> {
    const recipes = await this.prisma.recipe.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: RECIPE_INCLUDE,
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
      include: RECIPE_INCLUDE,
    });
    return this.toDto(updated);
  }

  async create(actor: AuthenticatedUser, dto: CreateRecipeDto): Promise<RecipeDto> {
    const organizationId = actor.organizationId;
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

    await this.assertValidIngredients(organizationId, dto.items);

    const recipe = await this.prisma.recipe.create({
      data: {
        organizationId,
        productId: dto.productId,
        yieldQuantity: dto.yieldQuantity,
        generalNotes: dto.generalNotes,
        pieceWeightG: dto.pieceWeightG,
        mixingTimeSlowMinutes: dto.mixingTimeSlowMinutes,
        mixingTimeFastMinutes: dto.mixingTimeFastMinutes,
        doughTempC: dto.doughTempC,
        shapingWeightG: dto.shapingWeightG,
        proofingTempC: dto.proofingTempC,
        proofingHumidityPercent: dto.proofingHumidityPercent,
        bakingTempC: dto.bakingTempC,
        bakingTimeMinutes: dto.bakingTimeMinutes,
        steamSeconds: dto.steamSeconds,
        fermentationMinutes: dto.fermentationMinutes,
        proofingMinutes: dto.proofingMinutes,
        lossPercent: dto.lossPercent,
        shelfLifeDays: dto.shelfLifeDays,
        items: {
          create: dto.items.map((item) => ({
            ingredientProductId: item.ingredientProductId,
            quantity: item.quantity,
          })),
        },
        steps: dto.steps
          ? { create: dto.steps.map((step) => ({ ...step })) }
          : undefined,
        revisions: {
          create: { changedById: actor.id, summary: "Техкарта создана" },
        },
      },
      include: RECIPE_INCLUDE,
    });

    return this.toDto(recipe);
  }

  async update(actor: AuthenticatedUser, recipeId: string, dto: UpdateRecipeDto): Promise<RecipeDto> {
    const organizationId = actor.organizationId;
    const recipe = await this.prisma.recipe.findFirst({
      where: { id: recipeId, organizationId },
      include: { items: true, steps: { orderBy: { sequence: "asc" } } },
    });
    if (!recipe) {
      throw new NotFoundException("Рецептура не найдена");
    }

    if (dto.items) {
      if (dto.items.some((item) => item.ingredientProductId === recipe.productId)) {
        throw new BadRequestException("Товар не может быть ингредиентом самого себя");
      }
      await this.assertValidIngredients(organizationId, dto.items);
    }

    const changeSummary = this.describeChanges(dto, recipe);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.recipeItem.deleteMany({ where: { recipeId } });
      }
      if (dto.steps) {
        await tx.recipeStep.deleteMany({ where: { recipeId } });
      }

      await tx.recipe.update({
        where: { id: recipeId },
        data: {
          yieldQuantity: dto.yieldQuantity,
          generalNotes: dto.generalNotes,
          pieceWeightG: dto.pieceWeightG,
          mixingTimeSlowMinutes: dto.mixingTimeSlowMinutes,
          mixingTimeFastMinutes: dto.mixingTimeFastMinutes,
          doughTempC: dto.doughTempC,
          shapingWeightG: dto.shapingWeightG,
          proofingTempC: dto.proofingTempC,
          proofingHumidityPercent: dto.proofingHumidityPercent,
          bakingTempC: dto.bakingTempC,
          bakingTimeMinutes: dto.bakingTimeMinutes,
          steamSeconds: dto.steamSeconds,
          fermentationMinutes: dto.fermentationMinutes,
          proofingMinutes: dto.proofingMinutes,
          lossPercent: dto.lossPercent,
          shelfLifeDays: dto.shelfLifeDays,
          items: dto.items
            ? { create: dto.items.map((item) => ({ ingredientProductId: item.ingredientProductId, quantity: item.quantity })) }
            : undefined,
          steps: dto.steps ? { create: dto.steps.map((step) => ({ ...step })) } : undefined,
          revisions: changeSummary
            ? { create: { changedById: actor.id, summary: changeSummary } }
            : undefined,
        },
      });

      return tx.recipe.findUniqueOrThrow({ where: { id: recipeId }, include: RECIPE_INCLUDE });
    });

    return this.toDto(updated);
  }

  // Compares the incoming dto against the recipe's current values so the
  // revision summary reflects what actually changed — the edit form always
  // submits every field, so a naive "was it present in the dto" check would
  // claim everything changed on every save.
  private describeChanges(
    dto: UpdateRecipeDto,
    current: {
      yieldQuantity: { toNumber: () => number };
      generalNotes: string | null;
      pieceWeightG: { toNumber: () => number } | null;
      mixingTimeSlowMinutes: number | null;
      mixingTimeFastMinutes: number | null;
      doughTempC: { toNumber: () => number } | null;
      shapingWeightG: { toNumber: () => number } | null;
      proofingTempC: { toNumber: () => number } | null;
      proofingHumidityPercent: { toNumber: () => number } | null;
      bakingTempC: { toNumber: () => number } | null;
      bakingTimeMinutes: number | null;
      steamSeconds: number | null;
      fermentationMinutes: number | null;
      proofingMinutes: number | null;
      lossPercent: { toNumber: () => number } | null;
      shelfLifeDays: number | null;
      items: { ingredientProductId: string; quantity: { toNumber: () => number } }[];
      steps: { sequence: number; instruction: string; durationMinutes: number | null }[];
    },
  ): string | null {
    const parts: string[] = [];

    if (dto.yieldQuantity !== undefined && dto.yieldQuantity !== current.yieldQuantity.toNumber()) {
      parts.push("выход");
    }
    if (dto.generalNotes !== undefined && dto.generalNotes !== (current.generalNotes ?? "")) {
      parts.push("общее описание");
    }
    if (dto.items !== undefined && !this.itemsEqual(dto.items, current.items)) {
      parts.push("ингредиенты");
    }
    if (dto.steps !== undefined && !this.stepsEqual(dto.steps, current.steps)) {
      parts.push("технология приготовления");
    }

    const num = (v: { toNumber: () => number } | null) => (v ? v.toNumber() : undefined);
    if (dto.pieceWeightG !== undefined && dto.pieceWeightG !== num(current.pieceWeightG)) {
      parts.push("вес изделия");
    }

    const productionParamsChanged =
      (dto.mixingTimeSlowMinutes !== undefined && dto.mixingTimeSlowMinutes !== (current.mixingTimeSlowMinutes ?? undefined)) ||
      (dto.mixingTimeFastMinutes !== undefined && dto.mixingTimeFastMinutes !== (current.mixingTimeFastMinutes ?? undefined)) ||
      (dto.doughTempC !== undefined && dto.doughTempC !== num(current.doughTempC)) ||
      (dto.shapingWeightG !== undefined && dto.shapingWeightG !== num(current.shapingWeightG)) ||
      (dto.proofingTempC !== undefined && dto.proofingTempC !== num(current.proofingTempC)) ||
      (dto.proofingHumidityPercent !== undefined && dto.proofingHumidityPercent !== num(current.proofingHumidityPercent)) ||
      (dto.bakingTempC !== undefined && dto.bakingTempC !== num(current.bakingTempC)) ||
      (dto.bakingTimeMinutes !== undefined && dto.bakingTimeMinutes !== (current.bakingTimeMinutes ?? undefined)) ||
      (dto.steamSeconds !== undefined && dto.steamSeconds !== (current.steamSeconds ?? undefined)) ||
      (dto.fermentationMinutes !== undefined && dto.fermentationMinutes !== (current.fermentationMinutes ?? undefined)) ||
      (dto.proofingMinutes !== undefined && dto.proofingMinutes !== (current.proofingMinutes ?? undefined));
    if (productionParamsChanged) parts.push("параметры производства");

    if (dto.lossPercent !== undefined && dto.lossPercent !== num(current.lossPercent)) {
      parts.push("производственные потери");
    }
    if (dto.shelfLifeDays !== undefined && dto.shelfLifeDays !== (current.shelfLifeDays ?? undefined)) {
      parts.push("срок годности");
    }

    if (parts.length === 0) return null;
    return `Изменено: ${parts.join(", ")}`;
  }

  private itemsEqual(
    a: { ingredientProductId: string; quantity: number }[],
    b: { ingredientProductId: string; quantity: { toNumber: () => number } }[],
  ): boolean {
    if (a.length !== b.length) return false;
    const sortByIngredient = (x: { ingredientProductId: string }, y: { ingredientProductId: string }) =>
      x.ingredientProductId.localeCompare(y.ingredientProductId);
    const sortedA = [...a].sort(sortByIngredient);
    const sortedB = [...b]
      .map((item) => ({ ingredientProductId: item.ingredientProductId, quantity: item.quantity.toNumber() }))
      .sort(sortByIngredient);
    return sortedA.every(
      (item, index) =>
        item.ingredientProductId === sortedB[index].ingredientProductId && item.quantity === sortedB[index].quantity,
    );
  }

  private stepsEqual(
    a: { sequence: number; instruction: string; durationMinutes?: number }[],
    b: { sequence: number; instruction: string; durationMinutes: number | null }[],
  ): boolean {
    if (a.length !== b.length) return false;
    return a.every((step, index) => {
      const other = b[index];
      return (
        step.sequence === other.sequence &&
        step.instruction === other.instruction &&
        (step.durationMinutes ?? null) === other.durationMinutes
      );
    });
  }

  private async assertValidIngredients(
    organizationId: string,
    items: { ingredientProductId: string; quantity: number }[],
  ) {
    const ingredientIds = items.map((i) => i.ingredientProductId);
    const ingredients = await this.prisma.product.findMany({
      where: { id: { in: ingredientIds }, organizationId },
    });
    if (ingredients.length !== new Set(ingredientIds).size) {
      throw new BadRequestException("Один или несколько ингредиентов не найдены");
    }
    if (ingredients.some((i) => i.type !== ProductType.RAW_MATERIAL)) {
      throw new BadRequestException("В качестве ингредиентов можно использовать только сырьё");
    }
  }

  private toDto = (recipe: {
    id: string;
    productId: string;
    product: { name: string; unit: string; price: { toNumber: () => number } };
    yieldQuantity: { toNumber: () => number };
    isActive: boolean;
    generalNotes: string | null;
    pieceWeightG: { toNumber: () => number } | null;
    mixingTimeSlowMinutes: number | null;
    mixingTimeFastMinutes: number | null;
    doughTempC: { toNumber: () => number } | null;
    shapingWeightG: { toNumber: () => number } | null;
    proofingTempC: { toNumber: () => number } | null;
    proofingHumidityPercent: { toNumber: () => number } | null;
    bakingTempC: { toNumber: () => number } | null;
    bakingTimeMinutes: number | null;
    steamSeconds: number | null;
    fermentationMinutes: number | null;
    proofingMinutes: number | null;
    lossPercent: { toNumber: () => number } | null;
    shelfLifeDays: number | null;
    items: {
      id: string;
      ingredientProductId: string;
      ingredientProduct: { name: string; unit: string; price: { toNumber: () => number } };
      quantity: { toNumber: () => number };
    }[];
    steps: {
      id: string;
      sequence: number;
      instruction: string;
      durationMinutes: number | null;
    }[];
    revisions: {
      id: string;
      changedAt: Date;
      summary: string;
      changedBy: { fullName: string };
    }[];
  }): RecipeDto => {
    const yieldQuantity = recipe.yieldQuantity.toNumber();
    const totalIngredientCost = recipe.items.reduce(
      (sum, item) => sum + item.quantity.toNumber() * item.ingredientProduct.price.toNumber(),
      0,
    );
    const lossPercent = recipe.lossPercent ? recipe.lossPercent.toNumber() : null;
    const effectiveYield = lossPercent ? yieldQuantity * (1 - lossPercent / 100) : yieldQuantity;
    const unitCost = effectiveYield > 0 ? totalIngredientCost / effectiveYield : 0;
    const productPrice = recipe.product.price.toNumber();
    const marginPercent = productPrice > 0 ? ((productPrice - unitCost) / productPrice) * 100 : null;

    const doughWeightExcludedIngredients: string[] = [];
    let doughWeightKg = 0;
    let hasWeighableIngredient = false;
    for (const item of recipe.items) {
      const factor = KG_CONVERSION_FACTOR[item.ingredientProduct.unit as Unit];
      if (factor === undefined) {
        doughWeightExcludedIngredients.push(item.ingredientProduct.name);
        continue;
      }
      hasWeighableIngredient = true;
      doughWeightKg += item.quantity.toNumber() * factor;
    }
    const resolvedDoughWeightKg = hasWeighableIngredient ? doughWeightKg : null;

    const pieceWeightG = recipe.pieceWeightG ? recipe.pieceWeightG.toNumber() : null;
    let suggestedYieldQuantity: number | null = null;
    if (resolvedDoughWeightKg !== null && pieceWeightG) {
      const bakedWeightG = resolvedDoughWeightKg * 1000 * (1 - (lossPercent ?? 0) / 100);
      suggestedYieldQuantity = Math.max(0, Math.floor(bakedWeightG / pieceWeightG));
    }

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
      steps: recipe.steps.map((step) => ({
        id: step.id,
        sequence: step.sequence,
        instruction: step.instruction,
        durationMinutes: step.durationMinutes,
      })),
      revisions: recipe.revisions.map((rev) => ({
        id: rev.id,
        changedAt: rev.changedAt.toISOString(),
        changedByName: rev.changedBy.fullName,
        summary: rev.summary,
      })),
      generalNotes: recipe.generalNotes,
      pieceWeightG,
      mixingTimeSlowMinutes: recipe.mixingTimeSlowMinutes,
      mixingTimeFastMinutes: recipe.mixingTimeFastMinutes,
      doughTempC: recipe.doughTempC ? recipe.doughTempC.toNumber() : null,
      shapingWeightG: recipe.shapingWeightG ? recipe.shapingWeightG.toNumber() : null,
      proofingTempC: recipe.proofingTempC ? recipe.proofingTempC.toNumber() : null,
      proofingHumidityPercent: recipe.proofingHumidityPercent ? recipe.proofingHumidityPercent.toNumber() : null,
      bakingTempC: recipe.bakingTempC ? recipe.bakingTempC.toNumber() : null,
      bakingTimeMinutes: recipe.bakingTimeMinutes,
      steamSeconds: recipe.steamSeconds,
      fermentationMinutes: recipe.fermentationMinutes,
      proofingMinutes: recipe.proofingMinutes,
      lossPercent,
      shelfLifeDays: recipe.shelfLifeDays,
      unitCost,
      marginPercent,
      isActive: recipe.isActive,
      doughWeightKg: resolvedDoughWeightKg,
      doughWeightExcludedIngredients,
      suggestedYieldQuantity,
    };
  };
}
