import { Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from "class-validator";
import { RecipeParameterKind } from "@bakery-os/shared";

export class RecipeStageParameterDto {
  @IsEnum(RecipeParameterKind)
  kind!: RecipeParameterKind;

  @IsOptional()
  @IsString()
  label?: string;

  @IsNumber()
  value!: number;
}

export class RecipeStageDto {
  @IsString()
  @MinLength(1)
  stageTypeId!: string;

  @IsInt()
  @Min(1)
  sequence!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeStageParameterDto)
  parameters!: RecipeStageParameterDto[];
}
