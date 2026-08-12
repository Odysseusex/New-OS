import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateShiftDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  employeeId!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
