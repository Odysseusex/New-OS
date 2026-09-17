import { IsOptional, IsString, MaxLength } from "class-validator";

export class VoidCouponDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
