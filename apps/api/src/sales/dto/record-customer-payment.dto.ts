import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";

export class RecordCustomerPaymentDto {
  @IsString()
  customerId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
