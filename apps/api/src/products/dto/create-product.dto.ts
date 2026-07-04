import { IsEnum, IsNumber, IsString, Min, MinLength } from "class-validator";
import { Unit } from "@bakery-os/shared";

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  sku!: string;

  @IsEnum(Unit)
  unit!: Unit;

  @IsString()
  @MinLength(2)
  category!: string;

  @IsNumber()
  @Min(0)
  price!: number;
}
