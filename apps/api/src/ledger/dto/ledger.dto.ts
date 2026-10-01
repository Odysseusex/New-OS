import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";
import { LedgerAccountType, NormalBalance, SystemAccountKey } from "@bakery-os/shared";

export class CreateLedgerAccountDto {
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(1) name!: string;
  @IsEnum(LedgerAccountType) type!: LedgerAccountType;
  @IsOptional() @IsEnum(NormalBalance) normalBalance?: NormalBalance;
  @IsOptional() @IsString() parentId?: string | null;
}

export class UpdateLedgerAccountDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsEnum(LedgerAccountType) type?: LedgerAccountType;
  @IsOptional() @IsEnum(NormalBalance) normalBalance?: NormalBalance;
}

export class EnableLedgerDto {
  @IsISO8601() startsAt!: string;
}

export class JournalLineDto {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsEnum(SystemAccountKey) systemAccountKey?: SystemAccountKey;
  // Amounts are validated for scale by the ledger itself (never silently rounded).
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) debit?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) credit?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() cashSection?: string;
  @IsOptional() @IsString() cashAccountId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() financeCategoryId?: string;
}

export class ManualJournalEntryDto {
  @IsISO8601() entryDate!: string;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsString() reference?: string;
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => JournalLineDto) lines!: JournalLineDto[];
}

export class OpeningLineDto {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsEnum(SystemAccountKey) systemAccountKey?: SystemAccountKey;
  @IsNumber({ maxDecimalPlaces: 2 }) amount!: number;
}

export class OpeningBalanceDto {
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => OpeningLineDto) lines!: OpeningLineDto[];
  @IsOptional() @IsString() note?: string;
}

export class ReverseEntryDto {
  @IsString() @MinLength(1) reason!: string;
}
