import { IsNumber, IsPositive } from "class-validator";

export class CompleteBatchDto {
  @IsNumber()
  @IsPositive()
  actualQuantity!: number;
}
