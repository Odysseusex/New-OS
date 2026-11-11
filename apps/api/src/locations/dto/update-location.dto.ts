import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MinLength, ValidateIf } from "class-validator";
import { LocationOwnership, LocationType } from "@bakery-os/shared";

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEnum(LocationType)
  type?: LocationType;

  @IsOptional()
  @IsEnum(LocationOwnership)
  ownership?: LocationOwnership;

  @IsOptional()
  @IsString()
  regionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  city?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  address?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  // Where this point's till sales go (null = «Розница»).
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  defaultDirectionId?: string | null;

  // The till at this point offers «Произвольная сумма».
  @IsOptional()
  @IsBoolean()
  tillOpenPrice?: boolean;
}
