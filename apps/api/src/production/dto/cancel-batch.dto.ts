import { ProductionCancelReason } from "@bakery-os/shared";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class CancelBatchDto {
  @IsOptional()
  @IsEnum(ProductionCancelReason)
  reason?: ProductionCancelReason;

  @IsOptional()
  @IsString()
  @MinLength(2)
  note?: string;
}
