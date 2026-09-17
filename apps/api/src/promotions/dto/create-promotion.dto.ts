import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class CreatePromotionRuleDto {
  @IsString()
  categoryId!: string;

  @IsInt()
  @Min(1)
  @Max(99)
  discountPercent!: number;
}

export class CreatePromotionDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxRedemptions?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePromotionRuleDto)
  rules!: CreatePromotionRuleDto[];
}
