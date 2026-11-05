import { IsDateString, IsOptional, IsString } from "class-validator";

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
  @IsString()
  direction?: string;
}
