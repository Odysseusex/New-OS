import { IsNumber, IsPositive, IsString } from "class-validator";

export class RecordInvoicePaymentDto {
  @IsString()
  accountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
