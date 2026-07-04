import { PrismaClient, Role, LocationType } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: "demo-org" },
    update: {},
    create: { id: "demo-org", name: "Пекарня «Колосок»" },
  });

  const region = await prisma.region.upsert({
    where: { id: "demo-region" },
    update: {},
    create: { id: "demo-region", name: "Алматы", organizationId: org.id },
  });

  const locations: {
    id: string;
    name: string;
    type: LocationType;
    city: string;
    address: string;
    lat: number;
    lng: number;
  }[] = [
    {
      id: "loc-production-1",
      name: "Производство №1",
      type: LocationType.BAKERY_PRODUCTION,
      city: "Алматы",
      address: "ул. Толе би, 15",
      lat: 43.2551,
      lng: 76.9126,
    },
    {
      id: "loc-store-1",
      name: "Магазин «Абай»",
      type: LocationType.STORE,
      city: "Алматы",
      address: "пр. Абая, 44",
      lat: 43.2389,
      lng: 76.9454,
    },
    {
      id: "loc-store-2",
      name: "Магазин «Достык»",
      type: LocationType.STORE,
      city: "Алматы",
      address: "пр. Достык, 91",
      lat: 43.2295,
      lng: 76.9581,
    },
    {
      id: "loc-warehouse-1",
      name: "Центральный склад",
      type: LocationType.WAREHOUSE,
      city: "Алматы",
      address: "ул. Раймбека, 212",
      lat: 43.2417,
      lng: 76.8862,
    },
  ];

  for (const loc of locations) {
    await prisma.location.upsert({
      where: { id: loc.id },
      update: {},
      create: { ...loc, organizationId: org.id, regionId: region.id },
    });
  }

  const passwordHash = await bcrypt.hash("password123", 10);

  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "owner@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "owner@bakery.demo",
      fullName: "Айгерим Оспанова",
      passwordHash,
      role: Role.OWNER,
    },
  });

  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "manager@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "manager@bakery.demo",
      fullName: "Данияр Ахметов",
      passwordHash,
      role: Role.STORE_MANAGER,
      regionId: region.id,
      locationId: "loc-store-1",
    },
  });

  console.log("Seed complete. Demo login: owner@bakery.demo / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
