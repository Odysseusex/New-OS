import { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// A point may charge another point's prices (Location.priceSourceLocationId) — one price list for
// several own shops, typed once. Every read of ProductLocationPrice for a point goes through here.
// Chains are refused when the link is set, so one step is always enough.
export async function priceListLocationId(db: Db, organizationId: string, locationId: string): Promise<string> {
  const location = await db.location.findFirst({
    where: { id: locationId, organizationId },
    select: { priceSourceLocationId: true },
  });
  return location?.priceSourceLocationId ?? locationId;
}

// For reports over many points at once: point id → the point whose prices it charges.
export async function priceListLocationMap(db: Db, organizationId: string): Promise<Map<string, string>> {
  const rows = await db.location.findMany({
    where: { organizationId, priceSourceLocationId: { not: null } },
    select: { id: true, priceSourceLocationId: true },
  });
  return new Map(rows.map((r) => [r.id, r.priceSourceLocationId!]));
}
