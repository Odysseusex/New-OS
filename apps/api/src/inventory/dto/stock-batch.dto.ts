import { Type } from "class-transformer";
import { WriteOffReason, STOCK_BATCH_MAX_LINES } from "@bakery-os/shared";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from "class-validator";

export class StockBatchLineDto {
  @IsString()
  productId!: string;

  // > 0 for a receipt/write-off (checked in the service); ≥ 0 for an adjustment's count.
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;
}

class StockBatchBase {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: "Добавьте хотя бы один товар" })
  @ArrayMaxSize(STOCK_BATCH_MAX_LINES, { message: `Не больше ${STOCK_BATCH_MAX_LINES} товаров за раз` })
  @ValidateNested({ each: true })
  @Type(() => StockBatchLineDto)
  lines!: StockBatchLineDto[];
}

export class ReceiveStockBatchDto extends StockBatchBase {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class WriteOffStockBatchDto extends StockBatchBase {
  @IsEnum(WriteOffReason)
  writeOffReason!: WriteOffReason;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdjustStockBatchDto extends StockBatchBase {
  @IsString()
  @MinLength(2)
  reason!: string;
}
