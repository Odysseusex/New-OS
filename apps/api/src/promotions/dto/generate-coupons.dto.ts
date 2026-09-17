import { IsInt, Max, Min } from "class-validator";

export class GenerateCouponsDto {
  // The Merey pilot's own stated ceiling is ~3000 in one run; 5000 leaves
  // headroom above that while still catching a stray extra zero (30000)
  // before it ever reaches generateCoupons().
  @IsInt()
  @Min(1)
  @Max(5000)
  count!: number;
}
