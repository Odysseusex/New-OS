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
import { RecipeStageDto } from "./recipe-stage.dto";

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
