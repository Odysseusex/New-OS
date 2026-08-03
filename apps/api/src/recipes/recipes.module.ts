import { Module } from "@nestjs/common";
import { RecipesService } from "./recipes.service";
import { RecipesController } from "./recipes.controller";
import { RecipeStageTypesService } from "./recipe-stage-types.service";
import { RecipeStageTypesController } from "./recipe-stage-types.controller";

@Module({
  providers: [RecipesService, RecipeStageTypesService],
  controllers: [RecipesController, RecipeStageTypesController],
  exports: [RecipesService],
})
export class RecipesModule {}
