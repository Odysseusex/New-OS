import { BadRequestException } from "@nestjs/common";
import { BUSINESS_DIRECTION_LABELS_RU, BUSINESS_DIRECTION_ORDER, BusinessDirection, DirectionContext } from "@bakery-os/shared";
import { Prisma } from "@prisma/client";

type Db = Pick<Prisma.TransactionClient, "direction" | "location">;

export interface DirectionRow {
  id: string;
  name: string;
  isActive: boolean;
  systemKey: BusinessDirection | null;
}

// The three directions every organization has («Опт», «Розница», «Заказы»), created
// on first use for an organization made after the migration (a sandbox, a test).
export async function ensureSystemDirections(db: Db, organizationId: string): Promise<Record<BusinessDirection, string>> {
  const read = () => db.direction.findMany({ where: { organizationId, systemKey: { not: null } }, select: { id: true, systemKey: true } });
  let rows = await read();
  if (rows.length < BUSINESS_DIRECTION_ORDER.length) {
    const have = new Set(rows.map((r) => r.systemKey));
    for (const key of BUSINESS_DIRECTION_ORDER.filter((k) => !have.has(k))) {
      const base = BUSINESS_DIRECTION_LABELS_RU[key];
      // A hand-made direction may already use the name.
      const taken = await db.direction.findFirst({ where: { organizationId, name: base }, select: { id: true } });
      await db.direction.createMany({ data: [{ organizationId, systemKey: key, name: taken ? `${base} (основное)` : base }], skipDuplicates: true });
    }
    rows = await read();
  }
  return Object.fromEntries(rows.map((r) => [r.systemKey!, r.id])) as Record<BusinessDirection, string>;
}

// Everything needed to put a sale in a direction, plus the directory in display order
// (the three system ones first, then the rest as they were added).
export async function loadDirectionContext(db: Db, organizationId: string): Promise<DirectionContext & { directions: DirectionRow[] }> {
  const system = await ensureSystemDirections(db, organizationId);
  const [rows, locations] = await Promise.all([
    db.direction.findMany({ where: { organizationId }, select: { id: true, name: true, isActive: true, systemKey: true }, orderBy: { createdAt: "asc" } }),
    db.location.findMany({ where: { organizationId }, select: { id: true, defaultDirectionId: true } }),
  ]);
  const rank = (r: { systemKey: string | null }) => (r.systemKey ? BUSINESS_DIRECTION_ORDER.indexOf(r.systemKey as BusinessDirection) : BUSINESS_DIRECTION_ORDER.length);
  const directions = rows
    .map((r) => ({ ...r, systemKey: (r.systemKey as BusinessDirection | null) ?? null }))
    .sort((a, b) => rank(a) - rank(b));
  return {
    system,
    locationDefault: Object.fromEntries(locations.map((l) => [l.id, l.defaultDirectionId])),
    directions,
  };
}

// A direction id sent by a form must be this organization's and active.
export async function assertDirection(db: Db, organizationId: string, directionId: string | null | undefined): Promise<void> {
  if (!directionId) return;
  const row = await db.direction.findFirst({ where: { id: directionId, organizationId }, select: { isActive: true } });
  if (!row) throw new BadRequestException("Направление не найдено");
  if (!row.isActive) throw new BadRequestException("Направление в архиве");
}
