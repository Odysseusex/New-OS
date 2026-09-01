import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { ProductType, Unit } from "@bakery-os/shared";

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  sku?: string;

  // Nullable, unlike sku: clearing a barcode is a legitimate edit (the
  // product stopped being a resold packaged item), so the form must be able
  // to send an explicit null rather than only omitting the field.
  @IsOptional()
  @IsString()
  barcode?: string | null;

  @IsOptional()
  @IsString()
  ntin?: string | null;

  @IsOptional()
  @IsEnum(Unit)
  unit?: Unit;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minQuantity?: number;
}
