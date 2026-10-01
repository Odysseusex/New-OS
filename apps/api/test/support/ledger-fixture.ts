import { SystemAccountKey } from "@bakery-os/shared";
import { PrismaService } from "../../src/prisma/prisma.service";
import { LedgerService } from "../../src/ledger/ledger.service";
import { IsolatedOrg } from "./isolated-org";

// Brings a throwaway organization to "ledger running": system accounts created,
// ledger started an hour ago so everything the spec does afterwards is on or
// after the start.
export async function startLedger(ledger: LedgerService, org: IsolatedOrg, hoursAgo = 1) {
  await ledger.initializeSystemAccounts(org.user);
  return ledger.enable(org.user, { startsAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString() });
}

// A system account's balance on its own normal side, straight from the book.
export async function glBalance(ledger: LedgerService, org: IsolatedOrg, key: SystemAccountKey, asOf?: Date): Promise<number> {
  const accounts = await ledger.listAccounts(org.organizationId);
  const account = accounts.find((a) => a.systemAccountKey === key);
  if (!account) throw new Error(`no system account ${key}`);
  const book = await ledger.getAccountLedger(org.organizationId, account.id, asOf ? { to: asOf.toISOString() } : {});
  return book.closingBalance;
}

export async function accountId(ledger: LedgerService, org: IsolatedOrg, key: SystemAccountKey): Promise<string> {
  const accounts = await ledger.listAccounts(org.organizationId);
  return accounts.find((a) => a.systemAccountKey === key)!.id;
}

export const countEntries = (prisma: PrismaService, org: IsolatedOrg, where: object = {}) =>
  prisma.journalEntry.count({ where: { organizationId: org.organizationId, ...where } });
