import { IsString, MinLength } from "class-validator";

export class UpdateFinanceCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
