import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
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
}
