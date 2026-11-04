import { IsEnum, IsObject, IsOptional } from "class-validator";
import { DirectionAllocationBase } from "@bakery-os/shared";

export class DirectionAllocationBodyDto {
  @IsEnum(DirectionAllocationBase)
  base!: DirectionAllocationBase;

  // Percent per direction, only for MANUAL; checked in the service (sum 100).
  @IsOptional()
  @IsObject()
  shares?: Record<string, number> | null;
}
