import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class CreateConsignmentPaymentDto {
  @IsString()
  supplierId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
