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

// Implemented in src so the sandbox («Песочница») can be removed the same way.
export { destroyOrganization as destroyOrg } from "../../src/common/destroy-organization";
