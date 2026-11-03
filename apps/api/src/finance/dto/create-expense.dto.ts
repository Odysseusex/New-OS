import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";
import { BusinessDirection } from "@bakery-os/shared";

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

  // Опт / розница / заказы; absent or null = a common cost.
  @IsOptional()
  @IsIn([...Object.values(BusinessDirection), null])
  direction?: BusinessDirection | null;
}
