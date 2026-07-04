import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { RECIPE_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { RecipesService } from "./recipes.service";
import { CreateRecipeDto } from "./dto/create-recipe.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("recipes")
export class RecipesController {
  constructor(private recipesService: RecipesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.recipesService.findAllForOrganization(user.organizationId);
  }

  @Post()
  @Roles(...RECIPE_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRecipeDto) {
    return this.recipesService.create(user.organizationId, dto);
  }
}
