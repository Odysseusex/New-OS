import { IsString, MinLength } from "class-validator";

export class CreateVehicleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  plateNumber!: string;
}
