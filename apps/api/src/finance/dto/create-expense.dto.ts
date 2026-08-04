import { IsBoolean, IsDateString, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class CreateExpenseDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  incurredOn?: string;

  @IsOptional()
  @IsBoolean()
  paidImmediately?: boolean;

  @IsOptional()
  @IsString()
  accountId?: string;
}
