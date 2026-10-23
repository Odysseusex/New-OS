import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";

export class ReconciliationLineDto {
  @IsString()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQuantity!: number;
}


export class SaveDailyReconciliationDto {
  @IsString()
  locationId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Дата должна быть в формате ГГГГ-ММ-ДД" })
  date!: string;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingCash?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedCash?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedCard?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedTransfer?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ReconciliationLineDto)
  lines!: ReconciliationLineDto[];
}

