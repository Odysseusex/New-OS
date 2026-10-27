import { PrismaService } from "../prisma/prisma.service";

// Deleting a whole organization: the sandbox («Песочница») when its owner
// removes it, and every spec's throwaway organization. NEVER call it for a real
// organization — the caller is responsible for knowing which one it holds.

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
export async function destroyOrganization(prisma: PrismaService, organizationId: string): Promise<string[]> {
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
