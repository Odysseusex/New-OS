import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateShiftDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  userId!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
