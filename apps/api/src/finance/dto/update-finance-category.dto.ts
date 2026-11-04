import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateFinanceCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}
