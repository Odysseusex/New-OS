import { IsEnum, IsNumber, IsOptional, IsString, MinLength } from "class-validator";
import { LocationOwnership, LocationType } from "@bakery-os/shared";

export class CreateLocationDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(LocationType)
  type!: LocationType;

  @IsOptional()
  @IsEnum(LocationOwnership)
  ownership?: LocationOwnership;

  @IsOptional()
  @IsString()
  regionId?: string;

  @IsString()
  @MinLength(2)
  city!: string;

  @IsString()
  @MinLength(2)
  address!: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}
