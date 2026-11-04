import { IsBoolean, IsNumber, IsOptional, IsString, MinLength } from "class-validator";

export class CashAdjustmentDto {
  @IsString()
  accountId!: string;

  @IsNumber()
  actualBalance!: number;

  @IsString()
  @MinLength(1)
  reason!: string;

  // The article the difference belongs to — or, for a shortage, `ownerWithdrawal`
  // (the organization's «Изъятие собственника», created classified if missing).
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  ownerWithdrawal?: boolean;
}
