import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { BusinessDirection } from "@bakery-os/shared";

export class GetPnlQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  // ДДС only: one account.
  @IsOptional()
  @IsString()
  accountId?: string;

  // ДДС only: one business direction.
  @IsOptional()
  @IsEnum(BusinessDirection)
  direction?: BusinessDirection;
}
