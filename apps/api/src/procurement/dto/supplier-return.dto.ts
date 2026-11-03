import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from "class-validator";
import { PURCHASE_REVISION_REASON_MIN } from "@bakery-os/shared";

export class SupplierReturnItemDto {
  @IsString()
  itemId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;
}

export class SupplierReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnItemDto)
  items!: SupplierReturnItemDto[];

  @IsString()
  @MinLength(PURCHASE_REVISION_REASON_MIN, { message: `Укажите причину возврата (не короче ${PURCHASE_REVISION_REASON_MIN} символов)` })
  reason!: string;

  @IsOptional()
  @IsString()
  refundAccountId?: string;
}
