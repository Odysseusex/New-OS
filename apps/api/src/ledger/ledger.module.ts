import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { LedgerController } from "./ledger.controller";
import { LedgerService } from "./ledger.service";
import { LedgerReportsService } from "./ledger-reports.service";
import { LedgerDiagnosticsService } from "./ledger-diagnostics.service";
import { LedgerPeriodSection } from "./ledger-period-section";

// The general ledger. Business modules do not import this: they post through the
// plain functions in event-posting.ts inside their own transactions.
@Module({
  imports: [FinanceModule],
  controllers: [LedgerController],
  providers: [LedgerService, LedgerReportsService, LedgerDiagnosticsService, LedgerPeriodSection],
  exports: [LedgerService, LedgerReportsService, LedgerDiagnosticsService],
})
export class LedgerModule {}
