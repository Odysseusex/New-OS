import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionBatchDto, ProductionBatchStatus, Unit } from "@bakery-os/shared";
import { ProductionBatchStatus as PrismaProductionBatchStatus, StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { CompleteBatchDto } from "./dto/complete-batch.dto";

@Injectable()
export class ProductionService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, requestedLocationId?: string): Promise<ProductionBatchDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const batches = await this.prisma.productionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
      orderBy: { scheduledFor: "desc" },
      take: 100,
    });

    return batches.map(this.toDto);
  }

  async create(user: AuthenticatedUser, dto: CreateBatchDto): Promise<ProductionBatchDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    const recipe = await this.prisma.recipe.findFirst({
      where: { id: dto.recipeId, organizationId: user.organizationId },
    });
    if (!recipe) {
      throw new NotFoundException("Рецептура не найдена");
    }

    const batch = await this.prisma.productionBatch.create({
      data: {
        organizationId: user.organizationId,
        locationId,
        recipeId: dto.recipeId,
        plannedQuantity: dto.plannedQuantity,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
        createdById: user.id,
      },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
    });

    return this.toDto(batch);
  }

  async complete(user: AuthenticatedUser, batchId: string, dto: CompleteBatchDto): Promise<ProductionBatchDto> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.productionBatch.findFirst({
        where: { id: batchId, organizationId: user.organizationId },
        include: { recipe: { include: { items: { include: { ingredientProduct: true } }, product: true } } },
      });
      if (!batch) {
        throw new NotFoundException("Задание не найдено");
      }
      this.assertLocationAccess(user, batch.locationId);
      if (batch.status !== PrismaProductionBatchStatus.PLANNED) {
        throw new BadRequestException("Задание уже обработано");
      }

      const scale = dto.actualQuantity / batch.recipe.yieldQuantity.toNumber();

      for (const item of batch.recipe.items) {
        const requiredQuantity = item.quantity.toNumber() * scale;
        const stockLevel = await tx.stockLevel.findUnique({
          where: { locationId_productId: { locationId: batch.locationId, productId: item.ingredientProductId } },
        });
        if (!stockLevel || stockLevel.quantity.toNumber() < requiredQuantity) {
          throw new BadRequestException(
            `Недостаточно ингредиента «${item.ingredientProduct.name}» на точке для этого объёма`,
          );
        }
      }

      for (const item of batch.recipe.items) {
        const requiredQuantity = item.quantity.toNumber() * scale;
        await tx.stockLevel.update({
          where: { locationId_productId: { locationId: batch.locationId, productId: item.ingredientProductId } },
          data: { quantity: { decrement: requiredQuantity } },
        });
      }

      await tx.stockMovement.createMany({
        data: batch.recipe.items.map((item) => ({
          organizationId: user.organizationId,
          locationId: batch.locationId,
          productId: item.ingredientProductId,
          type: StockMovementType.PRODUCTION_CONSUMPTION,
          quantity: item.quantity.toNumber() * scale,
          reason: "Расход на производственное задание",
          batchId: batch.id,
          createdById: user.id,
        })),
      });

      await tx.stockLevel.upsert({
        where: { locationId_productId: { locationId: batch.locationId, productId: batch.recipe.productId } },
        update: { quantity: { increment: dto.actualQuantity } },
        create: {
          organizationId: user.organizationId,
          locationId: batch.locationId,
          productId: batch.recipe.productId,
          quantity: dto.actualQuantity,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: user.organizationId,
          locationId: batch.locationId,
          productId: batch.recipe.productId,
          type: StockMovementType.PRODUCTION_OUTPUT,
          quantity: dto.actualQuantity,
          reason: "Выпуск по производственному заданию",
          batchId: batch.id,
          createdById: user.id,
        },
      });

      const updated = await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: PrismaProductionBatchStatus.COMPLETED,
          actualQuantity: dto.actualQuantity,
          completedAt: new Date(),
        },
        include: { location: true, recipe: { include: { product: true } }, createdBy: true },
      });

      return this.toDto(updated);
    });
  }

  async cancel(user: AuthenticatedUser, batchId: string): Promise<ProductionBatchDto> {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId },
    });
    if (!batch) {
      throw new NotFoundException("Задание не найдено");
    }
    this.assertLocationAccess(user, batch.locationId);
    if (batch.status !== PrismaProductionBatchStatus.PLANNED) {
      throw new BadRequestException("Задание уже обработано");
    }

    const updated = await this.prisma.productionBatch.update({
      where: { id: batchId },
      data: { status: PrismaProductionBatchStatus.CANCELLED },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
    });

    return this.toDto(updated);
  }

  private assertLocationAccess(user: AuthenticatedUser, locationId: string) {
    resolveLocationScope(user, locationId);
  }

  private toDto = (batch: {
    id: string;
    locationId: string;
    location: { name: string };
    recipeId: string;
    recipe: { productId: string; product: { name: string; unit: string } };
    status: string;
    plannedQuantity: { toNumber: () => number };
    actualQuantity: { toNumber: () => number } | null;
    scheduledFor: Date;
    completedAt: Date | null;
    createdBy: { fullName: string };
  }): ProductionBatchDto => ({
    id: batch.id,
    locationId: batch.locationId,
    locationName: batch.location.name,
    recipeId: batch.recipeId,
    productId: batch.recipe.productId,
    productName: batch.recipe.product.name,
    unit: batch.recipe.product.unit as Unit,
    status: batch.status as ProductionBatchStatus,
    plannedQuantity: batch.plannedQuantity.toNumber(),
    actualQuantity: batch.actualQuantity ? batch.actualQuantity.toNumber() : null,
    scheduledFor: batch.scheduledFor.toISOString(),
    completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
    createdByName: batch.createdBy.fullName,
  });
}
