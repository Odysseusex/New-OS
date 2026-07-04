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
}
