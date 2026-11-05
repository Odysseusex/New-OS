import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateDirectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  responsible?: string;
}

export class UpdateDirectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  responsible?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
