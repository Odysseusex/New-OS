import { IsEnum, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { CashSection } from "@bakery-os/shared";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CashFlowMonthlyQueryDto {
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
