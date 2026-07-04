import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";
import { ExpenseCategory } from "@bakery-os/shared";

export class CreateExpenseDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  incurredOn?: string;
}
