import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class CashTransferDto {
  @IsString()
  fromAccountId!: string;

  @IsString()
  toAccountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
