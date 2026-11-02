import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class ReceiveStockDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  // What one unit cost (raw materials only): moves the product's weighted average.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice?: number;
}
