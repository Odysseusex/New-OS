import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { CostBehavior, FinanceCategoryKind } from "@bakery-os/shared";

export class CreateFinanceCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(FinanceCategoryKind)
  kind!: FinanceCategoryKind;

  @IsOptional()
  @IsEnum(CostBehavior)
  costBehavior?: CostBehavior;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}
