import { IsEnum, IsString, MinLength } from "class-validator";
import { FinanceCategoryKind } from "@bakery-os/shared";

export class CreateFinanceCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(FinanceCategoryKind)
  kind!: FinanceCategoryKind;
}
