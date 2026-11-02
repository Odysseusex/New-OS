import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsNumber, IsString, Min, MinLength, ValidateNested } from "class-validator";
import { PURCHASE_REVISION_REASON_MIN } from "@bakery-os/shared";

export class ReviseItemDto {
  @IsString()
  itemId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;
}

export class RevisePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviseItemDto)
  items!: ReviseItemDto[];

  @IsString()
  @MinLength(PURCHASE_REVISION_REASON_MIN, { message: `Укажите причину исправления (не короче ${PURCHASE_REVISION_REASON_MIN} символов)` })
  reason!: string;
}
