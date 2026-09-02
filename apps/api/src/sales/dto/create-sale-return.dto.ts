import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";

class SaleReturnItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

export class CreateSaleReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleReturnItemDto)
  items!: SaleReturnItemDto[];

  @IsOptional()
  @IsString()
  reason?: string;

  // Defaults to true in the service: goods normally go back on the shelf, and
  // the cashier opts out for anything that cannot be resold.
  @IsOptional()
  @IsBoolean()
  restocked?: boolean;
}
