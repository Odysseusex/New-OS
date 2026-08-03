import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { RECIPE_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { RecipeStageTypesService } from "./recipe-stage-types.service";
import { CreateRecipeStageTypeDto } from "./dto/create-recipe-stage-type.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("recipe-stage-types")
export class RecipeStageTypesController {
  constructor(private stageTypesService: RecipeStageTypesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.stageTypesService.findAllForOrganization(user.organizationId);
  }

  @Post()
  @Roles(...RECIPE_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRecipeStageTypeDto) {
    return this.stageTypesService.create(user.organizationId, dto);
  }
}
