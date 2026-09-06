import { IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  // Position in the lists, lowest first. Omitted or null leaves the category
  // unplaced, after every placed one and ordered by name — where everything
  // sat before this field existed. Null has to pass validation rather than be
  // rejected as a non-integer, since it is a meaningful value here.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  sortOrder?: number | null;
}
