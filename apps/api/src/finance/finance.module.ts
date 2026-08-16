import { Module } from "@nestjs/common";
import { FinanceService } from "./finance.service";
import { FinanceController } from "./finance.controller";
import { CashAccountsService } from "./cash-accounts.service";
import { CashAccountsController } from "./cash-accounts.controller";
import { FinanceCategoriesService } from "./finance-categories.service";
import { FinanceCategoriesController } from "./finance-categories.controller";
import { CashMovementsService } from "./cash-movements.service";
import { CashMovementsController } from "./cash-movements.controller";
import { FinanceSetupService } from "./finance-setup.service";
import { FinanceSetupController } from "./finance-setup.controller";
import { PlannedFixedCostsService } from "./planned-fixed-costs.service";
import { PlannedFixedCostsController } from "./planned-fixed-costs.controller";

@Module({
  providers: [
    FinanceService,
    CashAccountsService,
    FinanceCategoriesService,
    CashMovementsService,
    FinanceSetupService,
    PlannedFixedCostsService,
  ],
  controllers: [
    FinanceController,
    CashAccountsController,
    FinanceCategoriesController,
    CashMovementsController,
    FinanceSetupController,
    PlannedFixedCostsController,
  ],
  // CashMovementsService is the single writer for the money ledger — other
  // modules (Sales, Invoices) inject it to record a movement as part of
  // their own transaction rather than duplicating that logic.
  // FinanceService/CashAccountsService are exported so read-only consumers
  // (AiModule) can reuse their existing aggregations (P&L, AR/AP, account
  // balances) instead of re-querying the same tables.
  exports: [CashMovementsService, FinanceService, CashAccountsService],
})
export class FinanceModule {}
