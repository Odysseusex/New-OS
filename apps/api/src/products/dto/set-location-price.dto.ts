import { IsNumber, Min } from "class-validator";

export class SetLocationPriceDto {
  @IsNumber()
  @Min(0)
  price!: number;
}
