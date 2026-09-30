import { Module } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController, ProcurementWorkflowController } from "./procurement.controller";
import { FinanceModule } from "../finance/finance.module";

@Module({
  imports: [FinanceModule],
  providers: [ProcurementService],
  controllers: [ProcurementController, ProcurementWorkflowController],
  exports: [ProcurementService],
})
export class ProcurementModule {}
