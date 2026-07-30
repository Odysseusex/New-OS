import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { ProductType, Unit } from "@bakery-os/shared";

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  sku?: string;

  @IsEnum(Unit)
  unit!: Unit;

  @IsEnum(ProductType)
  type!: ProductType;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minQuantity?: number;
}
