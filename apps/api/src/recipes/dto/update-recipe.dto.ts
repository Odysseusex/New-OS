import { Type } from "class-transformer";
import { IsArray, IsInt, IsNumber, IsOptional, IsPositive, Max, Min, IsString, ValidateNested } from "class-validator";
import { CreateRecipeItemDto } from "./create-recipe.dto";
import { RecipeStageDto } from "./recipe-stage.dto";

export class UpdateRecipeDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  yieldQuantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRecipeItemDto)
  items?: CreateRecipeItemDto[];

  @IsOptional()
  @IsString()
  generalNotes?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  pieceWeightG?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  lossPercent?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  shelfLifeDays?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeStageDto)
  stages?: RecipeStageDto[];
}
