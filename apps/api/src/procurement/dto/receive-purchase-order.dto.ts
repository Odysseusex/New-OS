import { Type } from "class-transformer";
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";

export class ReceiveItemDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;
}

export class PayNowDto {
  @IsString()
  accountId!: string;
}

export class ReceivePurchaseOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplierDocNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PayNowDto)
  payNow?: PayNowDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items?: ReceiveItemDto[];
}
