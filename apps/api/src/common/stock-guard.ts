import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

// Takes `quantity` off a StockLevel only if that much is actually there, in ONE
// statement: `UPDATE … SET quantity = quantity - q WHERE … AND quantity >= q`.
//
// The earlier pattern — read the level, compare, then decrement — let two
// concurrent operations both pass the read and together push stock below zero.
// Postgres serialises concurrent UPDATEs of the same row and re-checks the
// WHERE clause against the row the first one committed, so exactly as many
// callers succeed as the stock can cover; the rest match no row and are
// refused. This is the current BLOCK behaviour (stock never goes negative),
// now enforced by the database rather than by a read that can go stale.
//
// `insufficientMessage` is the caller's existing Russian error, so a refusal
// looks exactly like the one the read-check already produced.
export async function decrementStockOrThrow(
  tx: Prisma.TransactionClient,
  params: { locationId: string; productId: string; quantity: number | Prisma.Decimal },
  insufficientMessage: string,
): Promise<void> {
  const result = await tx.stockLevel.updateMany({
    where: {
      locationId: params.locationId,
      productId: params.productId,
      quantity: { gte: params.quantity },
    },
    data: { quantity: { decrement: params.quantity } },
  });
  if (result.count !== 1) {
    throw new BadRequestException(insufficientMessage);
  }
}

// Organization.allowNegativeStock: while no stock count has been made yet, production and the
// till may take stock below zero (the first stocktake then books the opening position) — except at a
// point marked `Location.strictStock`, whose shelf is always checked (cashiers checked by the stock).
export async function allowsNegativeStock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  locationId: string,
): Promise<boolean> {
  const [org, location] = await Promise.all([
    tx.organization.findUnique({ where: { id: organizationId }, select: { allowNegativeStock: true } }),
    tx.location.findFirst({ where: { id: locationId, organizationId }, select: { strictStock: true } }),
  ]);
  return (org?.allowNegativeStock ?? false) && !(location?.strictStock ?? false);
}

// Takes stock off a shelf: refused when short, unless the organization allows going below zero —
// then the level goes negative (a missing row is created negative, seeded with the product's threshold).
export async function decrementStock(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; locationId: string; productId: string; quantity: number; minQuantity?: Prisma.Decimal | number },
  insufficientMessage: string,
  allowNegative: boolean,
): Promise<void> {
  if (!allowNegative) {
    await decrementStockOrThrow(tx, params, insufficientMessage);
    return;
  }
  await tx.stockLevel.upsert({
    where: { locationId_productId: { locationId: params.locationId, productId: params.productId } },
    update: { quantity: { decrement: params.quantity } },
    create: {
      organizationId: params.organizationId,
      locationId: params.locationId,
      productId: params.productId,
      quantity: -params.quantity,
      minQuantity: params.minQuantity ?? 0,
    },
  });
}
