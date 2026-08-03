import { IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

export class AdjustStockDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0)
  actualQuantity!: number;

  @IsString()
  @MinLength(2)
  reason!: string;
}
