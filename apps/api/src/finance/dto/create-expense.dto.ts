import { IsBoolean, IsDateString, IsNumber, IsOptional, IsPositive, IsString, ValidateIf } from "class-validator";

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

  // A direction from the directory; absent or null = a common cost.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  directionId?: string | null;
}
