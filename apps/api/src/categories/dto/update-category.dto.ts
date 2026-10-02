import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";
import { ProductType } from "@bakery-os/shared";

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
