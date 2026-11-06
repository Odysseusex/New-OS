import { IsOptional, IsString } from "class-validator";

export class SetPriceSourceDto {
  // Another point of the organization, or null / empty for the point's own prices.
  @IsOptional()
  @IsString()
  sourceLocationId?: string | null;
}
