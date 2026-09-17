import { IsInt, Max, Min } from "class-validator";

export class GenerateCouponsDto {
  // Capped well below anything a paper-coupon test would ever need — a
  // typo here (a stray zero) should not silently mint a thousand codes.
  @IsInt()
  @Min(1)
  @Max(500)
  count!: number;
}
