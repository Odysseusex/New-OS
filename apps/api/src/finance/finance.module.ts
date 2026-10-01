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
import { AccountingPolicyService } from "./accounting-policy.service";
import { AccountingPolicyController } from "./accounting-policy.controller";
import { FinancialEventProjector } from "./events/projector";
import { FinancialPeriodsService } from "./periods/periods.service";
import { PeriodGuard } from "./periods/period-guard";
import { BalanceService } from "./balance/balance.service";
import { BalanceController } from "./balance/balance.controller";
import { FinancialPeriodsController } from "./periods/periods.controller";

@Module({
  providers: [
    FinanceService,
    CashAccountsService,
    FinanceCategoriesService,
    CashMovementsService,
    FinanceSetupService,
    PlannedFixedCostsService,
    AccountingPolicyService,
    FinancialEventProjector,
    FinancialPeriodsService,
    PeriodGuard,
    BalanceService,
  ],
  controllers: [
    FinanceController,
    CashAccountsController,
    FinanceCategoriesController,
    CashMovementsController,
    FinanceSetupController,
    PlannedFixedCostsController,
    AccountingPolicyController,
    FinancialPeriodsController,
    BalanceController,
  ],
  // CashMovementsService is the single writer for the money ledger — other
  // modules (Sales, Invoices) inject it to record a movement as part of
  // their own transaction rather than duplicating that logic.
  // FinanceService/CashAccountsService are exported so read-only consumers
  // (AiModule) can reuse their existing aggregations (P&L, AR/AP, account
  // balances) instead of re-querying the same tables.
  // FinanceCategoriesService is exported for TelegramModule's "add expense"
  // wizard, which needs the EXPENSE-kind category list for its picker.
  exports: [CashMovementsService, FinanceService, CashAccountsService, FinanceCategoriesService, FinancialEventProjector, FinancialPeriodsService, PeriodGuard, BalanceService, AccountingPolicyService],
})
export class FinanceModule {}
