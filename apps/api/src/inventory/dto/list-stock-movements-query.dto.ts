import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { StockMovementType } from "@bakery-os/shared";

export class ListStockMovementsQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
