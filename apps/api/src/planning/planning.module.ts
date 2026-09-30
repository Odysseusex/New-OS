import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { PlanningController } from "./planning.controller";
import { PlanningService } from "./planning.service";

@Module({
  imports: [FinanceModule],
  providers: [PlanningService],
  controllers: [PlanningController],
})
export class PlanningModule {}
