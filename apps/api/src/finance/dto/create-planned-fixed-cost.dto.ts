import { IsDateString, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreatePlannedFixedCostDto {
  @IsString()
  categoryId!: string;

  // Omit for an organization-wide cost ("Вся сеть").
  @IsOptional()
  @IsString()
  locationId?: string;

  // Always a per-month figure — see the PlannedFixedCost schema comment.
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
