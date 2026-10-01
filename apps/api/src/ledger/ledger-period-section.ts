import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialPeriodsService } from "../finance/periods/periods.service";
import { LedgerService } from "./ledger.service";
import { LedgerReportsService } from "./ledger-reports.service";

// Closing a month freezes what the general ledger said at that moment alongside
// the other statements: the cumulative trial balance, the month's P&L and the
// balance sheet. A ledger that is not running contributes nothing (null), so an
// organization that never turns it on closes its months exactly as before.
@Injectable()
export class LedgerPeriodSection implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private reports: LedgerReportsService,
    @Optional() private periods?: FinancialPeriodsService,
  ) {}

  onModuleInit() {
    this.register(this.periods);
  }

  register(periods: FinancialPeriodsService | undefined = this.periods) {
    periods?.registerSection({
      key: "generalLedger",
      build: async (organizationId, from, to) => {
        const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } });
        if (!org.ledgerStartsAt) return null;
        const [trialBalance, pnl, balance] = await Promise.all([
          this.ledger.getTrialBalance(organizationId, { to: to.toISOString() }),
          this.reports.getPnl(organizationId, from, to),
          this.reports.getBalanceSheet(organizationId, to),
        ]);
        return { startsAt: org.ledgerStartsAt.toISOString(), trialBalance, pnl, balance };
      },
    });
  }
}
