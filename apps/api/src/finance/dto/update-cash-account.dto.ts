import { IsString, MinLength } from "class-validator";

export class UpdateCashAccountDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
