import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { ConsignmentService } from "./consignment.service";
import { ConsignmentController } from "./consignment.controller";

// Settlements for goods held on consignment. Depends on FinanceModule for
// CashMovementsService — a payout is real money leaving a real account, so it
// goes through the one ledger writer like every other payment.
@Module({
  imports: [FinanceModule],
  providers: [ConsignmentService],
  controllers: [ConsignmentController],
  exports: [ConsignmentService],
})
export class ConsignmentModule {}
