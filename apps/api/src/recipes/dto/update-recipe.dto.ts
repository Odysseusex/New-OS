import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  IsString,
  ValidateNested,
} from "class-validator";
import { CreateRecipeItemDto } from "./create-recipe.dto";
import { RecipeStepDto } from "./recipe-step.dto";

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
  @IsInt()
  @IsPositive()
  mixingTimeSlowMinutes?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  mixingTimeFastMinutes?: number;

  @IsOptional()
  @IsNumber()
  doughTempC?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  shapingWeightG?: number;

  @IsOptional()
  @IsNumber()
  proofingTempC?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  proofingHumidityPercent?: number;

  @IsOptional()
  @IsNumber()
  bakingTempC?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  bakingTimeMinutes?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  steamSeconds?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  fermentationMinutes?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  proofingMinutes?: number;

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
  @Type(() => RecipeStepDto)
  steps?: RecipeStepDto[];
}
