import { BadRequestException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

// Goods «под реализацию» tied to ONE point of sale (`Product.consignmentLocationId`, the owner's control of
// where somebody else's goods may stand): they are sold, received and moved in only there. Called by the
// sale, the stock receipt (single and batch) and «Перемещение» into a point. Null = any point, as before.
export async function assertConsignmentAt(
  db: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
  locationId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const tied = await db.product.findMany({
    where: {
      organizationId,
      id: { in: [...new Set(productIds)] },
      consignmentSupplierId: { not: null },
      consignmentLocationId: { not: null },
      NOT: { consignmentLocationId: locationId },
    },
    select: { name: true, consignmentLocation: { select: { name: true } } },
  });
  if (tied.length === 0) return;
  const first = tied[0];
  const more = tied.length > 1 ? ` (и ещё ${tied.length - 1})` : "";
  throw new BadRequestException(
    `Товар под реализацию «${first.name}»${more} закреплён за точкой «${first.consignmentLocation?.name ?? "—"}» — на этой точке его нельзя продавать и ставить на остаток`,
  );
}
