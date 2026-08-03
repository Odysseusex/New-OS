import { IsString, MinLength } from "class-validator";

export class UpdateCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;
}
