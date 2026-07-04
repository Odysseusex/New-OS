import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsNumber, IsPositive, IsString, ValidateNested } from "class-validator";

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
}
