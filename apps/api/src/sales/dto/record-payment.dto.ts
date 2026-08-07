import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class RecordPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
