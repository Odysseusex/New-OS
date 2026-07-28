import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductType, RecipeDto, RecipeParameterKind, Unit } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateRecipeDto } from "./dto/create-recipe.dto";
import { UpdateRecipeDto } from "./dto/update-recipe.dto";

const RECIPE_INCLUDE = {
  product: true,
  items: { include: { ingredientProduct: true } },
  stages: {
    orderBy: { sequence: "asc" as const },
    include: { stageType: true, parameters: true },
  },
  revisions: { orderBy: { changedAt: "desc" as const }, include: { changedBy: true } },
};

// Ingredient units that can be summed into a dough weight. PCS can't be
// converted without knowing an average piece weight, so items in PCS are
// excluded from the sum rather than guessed at.
const KG_CONVERSION_FACTOR: Partial<Record<Unit, number>> = {
  [Unit.KG]: 1,
  [Unit.G]: 0.001,
  [Unit.L]: 1, // approximation: 1L water ≈ 1kg, standard baker's shorthand
  [Unit.ML]: 0.001,
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
    if (dto.stages) {
      await this.assertValidStages(organizationId, dto.stages);
    }

    const recipe = await this.prisma.recipe.create({
      data: {
        organizationId,
        productId: dto.productId,
        yieldQuantity: dto.yieldQuantity,
        generalNotes: dto.generalNotes,
        pieceWeightG: dto.pieceWeightG,
        lossPercent: dto.lossPercent,
        shelfLifeDays: dto.shelfLifeDays,
        items: {
          create: dto.items.map((item) => ({
            ingredientProductId: item.ingredientProductId,
            quantity: item.quantity,
          })),
        },
        stages: dto.stages ? { create: dto.stages.map((stage) => this.stageCreateInput(stage)) } : undefined,
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
      include: {
        items: true,
        stages: { orderBy: { sequence: "asc" }, include: { parameters: true } },
      },
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
    if (dto.stages) {
      await this.assertValidStages(organizationId, dto.stages);
    }

    const changeSummary = this.describeChanges(dto, recipe);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.recipeItem.deleteMany({ where: { recipeId } });
      }
      if (dto.stages) {
        // Cascades to recipe_stage_parameters.
        await tx.recipeStage.deleteMany({ where: { recipeId } });
      }

      await tx.recipe.update({
        where: { id: recipeId },
        data: {
          yieldQuantity: dto.yieldQuantity,
          generalNotes: dto.generalNotes,
          pieceWeightG: dto.pieceWeightG,
          lossPercent: dto.lossPercent,
          shelfLifeDays: dto.shelfLifeDays,
          items: dto.items
            ? { create: dto.items.map((item) => ({ ingredientProductId: item.ingredientProductId, quantity: item.quantity })) }
            : undefined,
          stages: dto.stages ? { create: dto.stages.map((stage) => this.stageCreateInput(stage)) } : undefined,
          revisions: changeSummary
            ? { create: { changedById: actor.id, summary: changeSummary } }
            : undefined,
        },
      });

      return tx.recipe.findUniqueOrThrow({ where: { id: recipeId }, include: RECIPE_INCLUDE });
    });

    return this.toDto(updated);
  }

  private stageCreateInput(stage: {
    stageTypeId: string;
    sequence: number;
    note?: string;
    parameters: { kind: RecipeParameterKind; label?: string; value: number }[];
  }) {
    return {
      stageTypeId: stage.stageTypeId,
      sequence: stage.sequence,
      note: stage.note,
      parameters: {
        create: stage.parameters.map((p) => ({ kind: p.kind, label: p.label, value: p.value })),
      },
    };
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
      lossPercent: { toNumber: () => number } | null;
      shelfLifeDays: number | null;
      items: { ingredientProductId: string; quantity: { toNumber: () => number } }[];
      stages: {
        stageTypeId: string;
        sequence: number;
        note: string | null;
        parameters: { kind: string; label: string | null; value: { toNumber: () => number } }[];
      }[];
    },
  ): string | null {
    const parts: string[] = [];
    const num = (v: { toNumber: () => number } | null) => (v ? v.toNumber() : undefined);

    if (dto.yieldQuantity !== undefined && dto.yieldQuantity !== current.yieldQuantity.toNumber()) {
      parts.push("выход");
    }
    if (dto.generalNotes !== undefined && dto.generalNotes !== (current.generalNotes ?? "")) {
      parts.push("общее описание");
    }
    if (dto.items !== undefined && !this.itemsEqual(dto.items, current.items)) {
      parts.push("ингредиенты");
    }
    if (dto.stages !== undefined && !this.stagesEqual(dto.stages, current.stages)) {
      parts.push("технологический процесс");
    }
    if (dto.pieceWeightG !== undefined && dto.pieceWeightG !== num(current.pieceWeightG)) {
      parts.push("вес изделия");
    }
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

  private stagesEqual(
    a: { stageTypeId: string; sequence: number; note?: string; parameters: { kind: string; label?: string; value: number }[] }[],
    b: {
      stageTypeId: string;
      sequence: number;
      note: string | null;
      parameters: { kind: string; label: string | null; value: { toNumber: () => number } }[];
    }[],
  ): boolean {
    if (a.length !== b.length) return false;
    return a.every((stage, index) => {
      const other = b[index];
      if (
        stage.stageTypeId !== other.stageTypeId ||
        stage.sequence !== other.sequence ||
        (stage.note ?? null) !== other.note ||
        stage.parameters.length !== other.parameters.length
      ) {
        return false;
      }
      return stage.parameters.every((param, paramIndex) => {
        const otherParam = other.parameters[paramIndex];
        return (
          param.kind === otherParam.kind &&
          (param.label ?? null) === otherParam.label &&
          param.value === otherParam.value.toNumber()
        );
      });
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

  private async assertValidStages(organizationId: string, stages: { stageTypeId: string }[]) {
    const stageTypeIds = stages.map((s) => s.stageTypeId);
    if (stageTypeIds.length === 0) return;
    const stageTypes = await this.prisma.recipeStageType.findMany({
      where: { id: { in: stageTypeIds }, organizationId },
    });
    if (stageTypes.length !== new Set(stageTypeIds).size) {
      throw new BadRequestException("Одна или несколько стадий процесса не найдены");
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
    lossPercent: { toNumber: () => number } | null;
    shelfLifeDays: number | null;
    items: {
      id: string;
      ingredientProductId: string;
      ingredientProduct: { name: string; unit: string; price: { toNumber: () => number } };
      quantity: { toNumber: () => number };
    }[];
    stages: {
      id: string;
      stageTypeId: string;
      stageType: { name: string };
      sequence: number;
      note: string | null;
      parameters: {
        id: string;
        kind: string;
        label: string | null;
        value: { toNumber: () => number };
      }[];
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
    const itemWeightsKg = new Map<string, number>();
    let doughWeightKg = 0;
    let hasWeighableIngredient = false;
    for (const item of recipe.items) {
      const factor = KG_CONVERSION_FACTOR[item.ingredientProduct.unit as Unit];
      if (factor === undefined) {
        doughWeightExcludedIngredients.push(item.ingredientProduct.name);
        continue;
      }
      hasWeighableIngredient = true;
      const weightKg = item.quantity.toNumber() * factor;
      itemWeightsKg.set(item.id, weightKg);
      doughWeightKg += weightKg;
    }
    const resolvedDoughWeightKg = hasWeighableIngredient ? doughWeightKg : null;

    const pieceWeightG = recipe.pieceWeightG ? recipe.pieceWeightG.toNumber() : null;
    let suggestedYieldQuantity: number | null = null;
    if (resolvedDoughWeightKg !== null && pieceWeightG) {
      const bakedWeightG = resolvedDoughWeightKg * 1000 * (1 - (lossPercent ?? 0) / 100);
      suggestedYieldQuantity = Math.max(0, Math.floor(bakedWeightG / pieceWeightG));
    }

    // A single WEIGHT_G parameter anywhere in the process (e.g. dough-piece
    // weight at shaping) — used to show the implied loss against the
    // finished piece weight. Ambiguous (or absent) if there's more than one.
    const weightParams = recipe.stages.flatMap((s) => s.parameters.filter((p) => p.kind === "WEIGHT_G"));
    const preBakeWeightG = weightParams.length === 1 ? weightParams[0].value.toNumber() : null;

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
        percentOfDoughWeight:
          resolvedDoughWeightKg && itemWeightsKg.has(item.id)
            ? (itemWeightsKg.get(item.id)! / resolvedDoughWeightKg) * 100
            : null,
      })),
      stages: recipe.stages.map((stage) => ({
        id: stage.id,
        stageTypeId: stage.stageTypeId,
        stageTypeName: stage.stageType.name,
        sequence: stage.sequence,
        note: stage.note,
        parameters: stage.parameters.map((p) => ({
          id: p.id,
          kind: p.kind as RecipeParameterKind,
          label: p.label,
          value: p.value.toNumber(),
        })),
      })),
      revisions: recipe.revisions.map((rev) => ({
        id: rev.id,
        changedAt: rev.changedAt.toISOString(),
        changedByName: rev.changedBy.fullName,
        summary: rev.summary,
      })),
      generalNotes: recipe.generalNotes,
      pieceWeightG,
      lossPercent,
      shelfLifeDays: recipe.shelfLifeDays,
      unitCost,
      marginPercent,
      isActive: recipe.isActive,
      doughWeightKg: resolvedDoughWeightKg,
      doughWeightExcludedIngredients,
      suggestedYieldQuantity,
      preBakeWeightG,
    };
  };
}
