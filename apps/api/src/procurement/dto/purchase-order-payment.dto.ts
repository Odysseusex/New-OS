import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from "class-validator";

export class RecordPurchaseOrderPaymentDto {
  @IsString()
  accountId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ReversePurchaseOrderPaymentDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
