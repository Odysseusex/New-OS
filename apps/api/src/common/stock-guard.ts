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
