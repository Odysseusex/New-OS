import { IsOptional, IsString } from "class-validator";

export class ClockInDto {
  @IsOptional()
  @IsString()
  locationId?: string;
}
