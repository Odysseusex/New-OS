import { IsDateString, IsOptional, IsString } from "class-validator";

export class GetKpiQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}
