import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateEmployeeDto {
  @IsString()
  fullName!: string;

  @IsString()
  position!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsDateString()
  hiredAt?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}
