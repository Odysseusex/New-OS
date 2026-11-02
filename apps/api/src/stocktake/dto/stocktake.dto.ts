import { IsEnum, IsNumber, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";
import { ProductType } from "@bakery-os/shared";

export class CreateStocktakeDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  // Only products of this type — e.g. the raw-material store counted on its own.
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateStocktakeLineDto {
  // null clears a count (the line becomes "not counted" again).
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQuantity?: number | null;

  @IsOptional()
  @IsString()
  note?: string | null;
}

export class CancelStocktakeDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
