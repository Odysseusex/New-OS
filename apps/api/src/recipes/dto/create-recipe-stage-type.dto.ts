import { IsString, MinLength } from "class-validator";

export class CreateRecipeStageTypeDto {
  @IsString()
  @MinLength(2)
  name!: string;
}
