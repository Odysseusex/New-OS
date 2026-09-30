import { IsNumber, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";

export class CreateStocktakeDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

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
