import { Module } from "@nestjs/common";
import { FinanceService } from "./finance.service";
import { FinanceController } from "./finance.controller";
import { CashAccountsService } from "./cash-accounts.service";
import { CashAccountsController } from "./cash-accounts.controller";
import { FinanceCategoriesService } from "./finance-categories.service";
import { FinanceCategoriesController } from "./finance-categories.controller";
import { CashMovementsService } from "./cash-movements.service";
import { CashMovementsController } from "./cash-movements.controller";

@Module({
  providers: [FinanceService, CashAccountsService, FinanceCategoriesService, CashMovementsService],
  controllers: [FinanceController, CashAccountsController, FinanceCategoriesController, CashMovementsController],
  // CashMovementsService is the single writer for the money ledger — other
  // modules (Sales, Invoices) inject it to record a movement as part of
  // their own transaction rather than duplicating that logic.
  exports: [CashMovementsService],
})
export class FinanceModule {}
