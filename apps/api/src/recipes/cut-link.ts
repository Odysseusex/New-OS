import { Prisma } from "@prisma/client";
import { ProductCutLinkDto, ProductType } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";

// «Нарезается из товара»: half a cake is its own product with its own price, cut from a whole one at
// the point of sale. The link is NOT a second piece of data — it is the product's техкарта («1 whole →
// N parts») plus `Product.makeOnSale`, so the cost of a half, the stock it takes and the books all come
// from the same place as any other batch. This reads the link back for the product card and lists.
export async function loadCutLinks(
  db: PrismaService | Prisma.TransactionClient,
  organizationId: string,
  productIds?: string[],
): Promise<Map<string, ProductCutLinkDto>> {
  const recipes = await db.recipe.findMany({
    where: {
      organizationId,
      isActive: true,
      product: { makeOnSale: true },
      ...(productIds ? { productId: { in: productIds } } : {}),
    },
    select: {
      productId: true,
      yieldQuantity: true,
      items: { select: { quantity: true, ingredientProduct: { select: { id: true, name: true, type: true } } } },
    },
  });
  const links = new Map<string, ProductCutLinkDto>();
  for (const recipe of recipes) {
    // A техкарта edited into something richer (several lines) is still made on sale, but it is no
    // longer a plain cut the product card can describe in one field.
    if (recipe.items.length !== 1) continue;
    const [line] = recipe.items;
    const quantity = line.quantity.toNumber();
    if (line.ingredientProduct.type !== ProductType.FINISHED_GOOD || !(quantity > 0)) continue;
    links.set(recipe.productId, {
      productId: line.ingredientProduct.id,
      productName: line.ingredientProduct.name,
      parts: Math.round((recipe.yieldQuantity.toNumber() / quantity) * 1000) / 1000,
    });
  }
  return links;
}
