import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsPositive, IsString, Min, ValidateNested } from "class-validator";

export class BatchConsumptionLineDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;
}

export class CompleteBatchDto {
  @IsNumber()
  @IsPositive()
  actualQuantity!: number;

  // Raw material really used where it differs from the norm; left out = the norm.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BatchConsumptionLineDto)
  consumption?: BatchConsumptionLineDto[];
}
