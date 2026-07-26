import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { RecipeStepDto } from "./recipe-step.dto";

export class CreateRecipeItemDto {
  @IsString()
  ingredientProductId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class CreateRecipeDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  yieldQuantity!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRecipeItemDto)
  items!: CreateRecipeItemDto[];

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
