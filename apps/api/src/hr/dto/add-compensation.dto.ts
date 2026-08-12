import { CompensationType } from "@bakery-os/shared";
import { IsDateString, IsEnum, IsNumber, IsOptional, Min } from "class-validator";

export class AddCompensationDto {
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsEnum(CompensationType)
  paymentType?: CompensationType;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
