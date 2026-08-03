import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RecipeStageTypeDto } from "@bakery-os/shared";
import { CreateRecipeStageTypeDto } from "./dto/create-recipe-stage-type.dto";

@Injectable()
export class RecipeStageTypesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string): Promise<RecipeStageTypeDto[]> {
    const stageTypes = await this.prisma.recipeStageType.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: "asc" },
    });
    return stageTypes.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive }));
  }

  async create(organizationId: string, dto: CreateRecipeStageTypeDto): Promise<RecipeStageTypeDto> {
    const existing = await this.prisma.recipeStageType.findUnique({
      where: { organizationId_name: { organizationId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException("Такая стадия уже есть в списке");
    }

    const stageType = await this.prisma.recipeStageType.create({ data: { ...dto, organizationId } });
    return { id: stageType.id, name: stageType.name, isActive: stageType.isActive };
  }
}
