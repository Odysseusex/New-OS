import { IsInt, IsOptional, IsPositive, IsString, Min, MinLength } from "class-validator";

export class RecipeStepDto {
  @IsInt()
  @Min(1)
  sequence!: number;

  @IsString()
  @MinLength(2)
  instruction!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  durationMinutes?: number;
}
