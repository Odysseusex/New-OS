import { Prisma } from "@prisma/client";
import { CashAccountType } from "@bakery-os/shared";

// Where a point's card / Kaspi / transfer takings land: the account chosen for
// that point (Location.nonCashAccountId) while it is active, otherwise the
// organization's default bank account. Null = none configured (the sale still
// goes through; it just gains no cash movement — see SalesService).
export async function nonCashAccountFor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  locationId: string,
): Promise<string | null> {
  const location = await tx.location.findFirst({
    where: { id: locationId, organizationId },
    select: { nonCashAccount: { select: { id: true, isActive: true } } },
  });
  if (location?.nonCashAccount?.isActive) return location.nonCashAccount.id;
  const bank = await tx.cashAccount.findFirst({
    where: { organizationId, type: CashAccountType.BANK, isDefault: true, isActive: true },
    select: { id: true },
  });
  return bank?.id ?? null;
}
