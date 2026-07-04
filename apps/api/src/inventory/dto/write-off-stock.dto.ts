import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from "class-validator";

export class WriteOffStockDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsString()
  @MinLength(2)
  reason!: string;
}
