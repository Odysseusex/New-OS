import { IsDateString, IsNumber, IsOptional, IsPositive } from "class-validator";

export class UpdateBatchDto {
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  plannedQuantity?: number;
}
