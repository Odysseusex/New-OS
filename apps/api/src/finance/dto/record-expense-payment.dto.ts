import { IsNumber, IsPositive, IsString } from "class-validator";

export class RecordExpensePaymentDto {
  @IsString()
  accountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
