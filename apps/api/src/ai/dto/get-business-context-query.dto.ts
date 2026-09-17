import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";
import type { BusinessContextLevel } from "@bakery-os/shared";

export class GetBusinessContextQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  // Omitted means the whole network. A location the caller may not see is
  // rejected downstream by resolveLocationScope, the same guard every other
  // location-filtered report goes through.
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsIn(["quick", "business", "full"])
  level?: BusinessContextLevel;

  // Comma-separated module list. Kept as a plain string rather than an array
  // because the global ValidationPipe runs with whitelist:true and would
  // strip a repeated query parameter shape; the service validates each name
  // against BUSINESS_CONTEXT_MODULES.
  @IsOptional()
  @IsString()
  modules?: string;
}
