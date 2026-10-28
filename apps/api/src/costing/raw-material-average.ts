import { Prisma } from "@prisma/client";
import { movingAverageAfterPurchase, ProductType } from "@bakery-os/shared";
import { round2, round4 } from "../common/money";

// A raw material bought at a stated price moves its weighted average (D2): the
// stock on hand at all locations at the old average, plus this delivery at its
// price, over the new quantity. Before the first priced receipt the average is
// the price on the card, so stock already on the shelf keeps the value it had.
//
// Called inside the receipt's transaction, BEFORE its stock is added, by every
// path that buys: Склад → Приёмка with a price, a purchase order received, a
// supplier invoice confirmed. Anything else that adds stock (a return, a count,
// production) comes in at the average and leaves it alone. The product row is
// locked, so two deliveries at once cannot overwrite each other's average.
// The card's price becomes the latest purchase price (shown on the next receipt).
// Returns the new average, or null for anything that is not a raw material.
export async function recordRawMaterialPurchase(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number,
  unitPrice: number,
): Promise<number | null> {
  if (!(quantity > 0)) return null;
  const [product] = await tx.$queryRaw<{ type: string; price: Prisma.Decimal; averageUnitCost: Prisma.Decimal | null }[]>`
    SELECT "type", "price", "averageUnitCost" FROM "products" WHERE "id" = ${productId} FOR UPDATE`;
  if (!product || product.type !== ProductType.RAW_MATERIAL) return null;
  const onHand = await tx.stockLevel.aggregate({ _sum: { quantity: true }, where: { productId } });
  const average = round4(
    movingAverageAfterPurchase(
      onHand._sum.quantity?.toNumber() ?? 0,
      product.averageUnitCost !== null ? Number(product.averageUnitCost) : Number(product.price),
      quantity,
      unitPrice,
    ),
  );
  await tx.product.update({ where: { id: productId }, data: { averageUnitCost: average, price: round2(unitPrice) } });
  return average;
}
