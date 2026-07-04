import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class CreateBatchDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  recipeId!: string;

  @IsNumber()
  @IsPositive()
  plannedQuantity!: number;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}
