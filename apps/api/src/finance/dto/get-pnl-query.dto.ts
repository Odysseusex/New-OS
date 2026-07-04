import { IsDateString, IsOptional, IsString } from "class-validator";

export class GetPnlQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}
