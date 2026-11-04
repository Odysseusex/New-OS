import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { TillShiftsController } from "./till-shifts.controller";
import { TillShiftsService } from "./till-shifts.service";

@Module({
  imports: [FinanceModule],
  providers: [TillShiftsService],
  controllers: [TillShiftsController],
})
export class TillShiftsModule {}
