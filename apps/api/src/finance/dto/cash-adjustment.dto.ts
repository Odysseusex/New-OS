import { IsNumber, IsString, MinLength } from "class-validator";

export class CashAdjustmentDto {
  @IsString()
  accountId!: string;

  @IsNumber()
  actualBalance!: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}
