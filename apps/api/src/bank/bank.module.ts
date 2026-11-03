import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { ProcurementModule } from "../procurement/procurement.module";
import { BankStatementsController } from "./bank-statements.controller";
import { BankStatementsService } from "./bank-statements.service";

@Module({
  imports: [FinanceModule, ProcurementModule],
  controllers: [BankStatementsController],
  providers: [BankStatementsService],
})
export class BankModule {}
