import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { CashSection } from "@bakery-os/shared";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// ДДС for one point or one account (both optional).
export class CashScopeQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  direction?: string;
}

export class CashFlowMonthlyQueryDto extends CashScopeQueryDto {
  @Matches(MONTH, { message: "Месяц — в формате ГГГГ-ММ" })
  fromMonth!: string;

  @Matches(MONTH, { message: "Месяц — в формате ГГГГ-ММ" })
  toMonth!: string;
}

export class CashFlowOperationsQueryDto extends CashFlowMonthlyQueryDto {
  @IsEnum(CashSection)
  section!: CashSection;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// ДДС by weeks or by days: from/to are dates, "YYYY-MM-DD".
export class CashFlowByDateQueryDto extends CashScopeQueryDto {
  @IsIn(["week", "day"])
  granularity!: "week" | "day";

  @Matches(DATE, { message: "Дата — в формате ГГГГ-ММ-ДД" })
  fromDate!: string;

  @Matches(DATE, { message: "Дата — в формате ГГГГ-ММ-ДД" })
  toDate!: string;
}

export class CashFlowDateOperationsQueryDto extends CashScopeQueryDto {
  @Matches(DATE, { message: "Дата — в формате ГГГГ-ММ-ДД" })
  fromDate!: string;

  @Matches(DATE, { message: "Дата — в формате ГГГГ-ММ-ДД" })
  toDate!: string;

  @IsEnum(CashSection)
  section!: CashSection;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;
}
