import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, FinancialPeriodStatus as PrismaStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { monthOf } from "../../common/reporting-period";

// Refuses a write dated inside a period that is closed (or being closed).
// Writes dated NOW are never affected: a period can only be closed once it has
// fully elapsed, so "now" is never inside a closed one. Kept apart from the
// period service so any module can use it without depending on reporting.
@Injectable()
export class PeriodGuard {
  constructor(private prisma: PrismaService) {}

  async assertOpen(
    organizationId: string,
    date: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const { year, month } = monthOf(date);
    const period = await client.financialPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
      select: { status: true },
    });
    if (period && period.status !== PrismaStatus.OPEN) {
      throw new BadRequestException(
        `Период ${String(month).padStart(2, "0")}.${year} закрыт — операцию с этой датой провести нельзя. ` +
          `Исправление вносится текущим периодом (сторно, корректировка).`,
      );
    }
  }
}
