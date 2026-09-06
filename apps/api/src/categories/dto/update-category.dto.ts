import { IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";

export class UpdateCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  // Explicit null is meaningful — it puts the category back in the unplaced
  // group — so it has to pass validation rather than be rejected as a
  // non-integer.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  sortOrder?: number | null;
}
