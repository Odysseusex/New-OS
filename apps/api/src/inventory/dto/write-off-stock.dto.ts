import { WriteOffReason } from "@bakery-os/shared";
import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, MinLength } from "class-validator";

export class WriteOffStockDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsEnum(WriteOffReason)
  writeOffReason!: WriteOffReason;

  @IsOptional()
  @IsString()
  @MinLength(2)
  reason?: string;
}
