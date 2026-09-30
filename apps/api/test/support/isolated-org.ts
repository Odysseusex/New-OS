import { Role } from "@bakery-os/shared";
import { PrismaService } from "../../src/prisma/prisma.service";
import { AuthenticatedUser } from "../../src/auth/auth.types";

// A throwaway organization owned by ONE spec. The older money specs share the
// "demo-org" and have to keep every assertion to their own fixture rows; a
// characterization test pins organization-wide totals, so it needs an
// organization nobody else writes to. Nothing here reads or changes demo data.

export interface IsolatedOrg {
  organizationId: string;
  storeId: string;
  warehouseId: string;
  user: AuthenticatedUser;
  cashAccountId: string;
  bankAccountId: string;
}

export async function createIsolatedOrg(prisma: PrismaService, label: string): Promise<IsolatedOrg> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const organizationId = `iso-${label}-${stamp}`;

  await prisma.organization.create({ data: { id: organizationId, name: `Тест ${label}` } });

  const store = await prisma.location.create({
    data: { organizationId, name: "Точка А", type: "STORE", city: "Тест", address: "Тест" },
  });
  const warehouse = await prisma.location.create({
    data: { organizationId, name: "Склад", type: "WAREHOUSE", city: "Тест", address: "Тест" },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId,
      fullName: "Тест Владелец",
      email: `owner-${stamp}@iso.test`,
      passwordHash: "not-a-real-hash",
      role: Role.OWNER,
    },
  });
  const cash = await prisma.cashAccount.create({
    data: { organizationId, name: "Касса А", type: "CASH", locationId: store.id },
  });
  const bank = await prisma.cashAccount.create({
    data: { organizationId, name: "Банк", type: "BANK", isDefault: true },
  });

  return {
    organizationId,
    storeId: store.id,
    warehouseId: warehouse.id,
    cashAccountId: cash.id,
    bankAccountId: bank.id,
    user: {
      id: owner.id,
      email: owner.email,
      fullName: owner.fullName,
      role: Role.OWNER,
      title: null,
      organizationId,
      regionId: null,
      locationId: null,
    },
  };
}

async function tablesWithOrganizationId(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId' AND table_name <> 'organizations'
  `;
  return rows.map((r) => r.table_name);
}

// Deletes everything the organization owns, in whatever order the foreign keys
// allow (repeated passes: a table that is still referenced is retried after
// its referrers are gone), then the organization itself. Returns the names of
// any tables that still hold rows for it, which a spec should assert is empty
// so a fixture leak fails loudly instead of silently polluting the database.
export async function destroyOrg(prisma: PrismaService, organizationId: string): Promise<string[]> {
  const tables = await tablesWithOrganizationId(prisma);
  let pending = [...tables];

  for (let pass = 0; pass < 12 && pending.length > 0; pass += 1) {
    const stillBlocked: string[] = [];
    for (const table of pending) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, organizationId);
      } catch {
        stillBlocked.push(table);
      }
    }
    if (stillBlocked.length === pending.length) break;
    pending = stillBlocked;
  }

  await prisma.$executeRawUnsafe(`DELETE FROM "organizations" WHERE "id" = $1`, organizationId);

  const leftovers: string[] = [];
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "${table}" WHERE "organizationId" = $1`,
      organizationId,
    );
    if (Number(rows[0].count) > 0) leftovers.push(table);
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (org) leftovers.push("organizations");
  return leftovers;
}
