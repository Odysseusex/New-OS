import { IsOptional, IsString } from "class-validator";

export class ClockInForDto {
  @IsOptional()
  @IsString()
  locationId?: string;
}
