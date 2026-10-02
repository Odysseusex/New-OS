import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

export class ClassificationRowDto {
  @IsString()
  @MaxLength(100)
  sku!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subcategory?: string;
}

export class ClassificationPreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ClassificationRowDto)
  rows!: ClassificationRowDto[];
}

export class ClassificationApplyDto extends ClassificationPreviewDto {
  @IsString()
  @MaxLength(100)
  fingerprint!: string;

  @IsOptional()
  @IsBoolean()
  acceptRejected?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ClassificationRevertDto {
  @IsOptional()
  @IsBoolean()
  removeEmptyCategories?: boolean;
}
