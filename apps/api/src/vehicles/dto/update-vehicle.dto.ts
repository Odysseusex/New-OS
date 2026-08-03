import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { VehicleStatus } from "@prisma/client";

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  plateNumber?: string;

  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;
}
