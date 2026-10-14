import { Prisma } from "@prisma/client";

// Row locks on products, taken in id order so two transactions never wait on each
// other in a circle. Used where a product's moving average cost is read and moved
// (a stocked semi-finished product): the average and the stock quantity must be
// seen together, so whoever touches them first holds the others off until commit.
export async function lockProductRows(tx: Prisma.TransactionClient, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "products" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
}
