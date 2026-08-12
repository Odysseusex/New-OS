import { IsEnum } from "class-validator";
import { CostBehavior } from "@bakery-os/shared";

export class SetCostBehaviorDto {
  @IsEnum(CostBehavior)
  costBehavior!: CostBehavior;
}
