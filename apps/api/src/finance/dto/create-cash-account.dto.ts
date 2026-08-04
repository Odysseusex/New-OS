import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MinLength } from "class-validator";
import { CashAccountType } from "@bakery-os/shared";

export class CreateCashAccountDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(CashAccountType)
  type!: CashAccountType;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;
}
