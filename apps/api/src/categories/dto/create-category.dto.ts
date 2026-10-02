import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";
import { ProductType } from "@bakery-os/shared";

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

  // The product type this category holds (top-level categories only; a
  // subcategory takes its parent's).
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  // Makes it a subcategory of that category. On update: omitted keeps the
  // parent, null makes it top-level.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  parentId?: string | null;
}
