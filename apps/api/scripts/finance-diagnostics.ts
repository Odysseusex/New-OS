/* eslint-disable no-console */
// READ-ONLY finance diagnostics, for rehearsing a migration or a backfill on a
// database branch before it reaches production.
//
//   consistency  compare StockLevel / CashAccount caches with their ledgers
//   baseline     dump today's P&L, cash flow, valuation, receivables and
//                payables as JSON, so the same dump taken before and after a
//                change can be diffed: only the figures a phase meant to change
//                may differ
//
// Usage (DATABASE_URL comes from apps/api/.env or the environment):
//   pnpm --filter @bakery-os/api finance:diagnostics consistency --org <id> [--fail-on-drift]
//   pnpm --filter @bakery-os/api finance:diagnostics baseline --org <id> --from 2026-01-01 --to 2026-09-30 --out before.json
//
// It only ever calls find / group / aggregate. It writes nothing to the
// database, and the only file it writes is the --out path you give it.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaService } from "../src/prisma/prisma.service";
import { CashMovementsService } from "../src/finance/cash-movements.service";
import { FinanceService } from "../src/finance/finance.service";
import { checkLedgerConsistency } from "../src/finance/integrity/ledger-consistency";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Prisma loads apps/api/.env itself, which does not put DATABASE_URL into
// process.env — so the host shown to the operator is read the same two ways.
function databaseHost(): string {
  let url = process.env.DATABASE_URL;
  const envFile = join(__dirname, "..", ".env");
  if (!url && existsSync(envFile)) {
    url = readFileSync(envFile, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1];
  }
  try {
    return new URL(url ?? "").host || "(unknown)";
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  const command = process.argv[2];
  const organizationId = arg("org");
  if (!["consistency", "baseline"].includes(command) || !organizationId) {
    console.error("Usage: finance-diagnostics <consistency|baseline> --org <organizationId> [options]");
    process.exit(2);
  }

  // Printed first so an operator can see WHICH database is about to be read.
  console.error(`[finance-diagnostics] ${command} on ${databaseHost()} for organization ${organizationId}`);

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    if (command === "consistency") {
      const report = await checkLedgerConsistency(prisma, organizationId);
      console.log(JSON.stringify(report, null, 2));
      if (!report.isConsistent && process.argv.includes("--fail-on-drift")) process.exitCode = 1;
      return;
    }

    const from = new Date(arg("from") ?? new Date(Date.now() - 30 * 24 * 3600 * 1000));
    const to = new Date(arg("to") ?? new Date());
    const finance = new FinanceService(prisma, new CashMovementsService(prisma));
    const baseline = {
      organizationId,
      period: { from: from.toISOString(), to: to.toISOString() },
      profitAndLoss: await finance.getProfitAndLoss(organizationId, from, to),
      cashFlow: await finance.getCashFlow(organizationId, from, to),
      inventoryValuation: await finance.getInventoryValuation(organizationId),
      accountsReceivable: await finance.getAccountsReceivable(organizationId),
      accountsPayable: await finance.getAccountsPayable(organizationId),
      consignmentOwed: await finance.getConsignmentOwed(organizationId),
      consistency: await checkLedgerConsistency(prisma, organizationId),
    };
    // The one time-varying field is stripped so two dumps of unchanged data diff clean.
    (baseline.consistency as { generatedAt?: string }).generatedAt = undefined;

    const json = JSON.stringify(baseline, null, 2);
    const out = arg("out");
    if (out) {
      writeFileSync(out, `${json}\n`);
      console.error(`[finance-diagnostics] wrote ${out}`);
    } else {
      console.log(json);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
