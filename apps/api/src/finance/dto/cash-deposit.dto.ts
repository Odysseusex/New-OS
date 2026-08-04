import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class CashDepositDto {
  @IsString()
  accountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
