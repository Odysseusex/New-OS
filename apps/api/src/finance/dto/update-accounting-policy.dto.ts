import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";
import {
  BalanceControlMode,
  DepreciationMethod,
  NegativeStockPolicy,
  ReturnScrapPresentation,
  WriteOffPresentation,
} from "@bakery-os/shared";

// `null` is a legitimate value (withdraw an approval), so each field is
// validated only when a non-null value is sent. Absent fields are untouched.
export class UpdateAccountingPolicyDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(NegativeStockPolicy)
  negativeStockPolicy?: NegativeStockPolicy | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(WriteOffPresentation)
  writeOffPresentation?: WriteOffPresentation | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(ReturnScrapPresentation)
  returnScrapPresentation?: ReturnScrapPresentation | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(BalanceControlMode)
  balanceControlMode?: BalanceControlMode | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  capitalizationThreshold?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(DepreciationMethod)
  depreciationMethod?: DepreciationMethod | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  depreciationUsefulLifeMonths?: number | null;

  @IsString()
  @MinLength(3)
  reason!: string;
}
