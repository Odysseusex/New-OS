import { PrismaClient, Role, LocationType, Unit, StockMovementType, ProductionBatchStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ORG_ID = "demo-org";
const REGION_ID = "demo-region";
const LOC_PRODUCTION = "loc-production-1";
const LOC_STORE_1 = "loc-store-1";
const LOC_STORE_2 = "loc-store-2";
const LOC_WAREHOUSE = "loc-warehouse-1";

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { id: ORG_ID, name: "Пекарня «Колосок»" },
  });

  const region = await prisma.region.upsert({
    where: { id: REGION_ID },
    update: {},
    create: { id: REGION_ID, name: "Алматы", organizationId: org.id },
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
      id: LOC_PRODUCTION,
      name: "Производство №1",
      type: LocationType.BAKERY_PRODUCTION,
      city: "Алматы",
      address: "ул. Толе би, 15",
      lat: 43.2551,
      lng: 76.9126,
    },
    {
      id: LOC_STORE_1,
      name: "Магазин «Абай»",
      type: LocationType.STORE,
      city: "Алматы",
      address: "пр. Абая, 44",
      lat: 43.2389,
      lng: 76.9454,
    },
    {
      id: LOC_STORE_2,
      name: "Магазин «Достык»",
      type: LocationType.STORE,
      city: "Алматы",
      address: "пр. Достык, 91",
      lat: 43.2295,
      lng: 76.9581,
    },
    {
      id: LOC_WAREHOUSE,
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

  const owner = await prisma.user.upsert({
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
      locationId: LOC_STORE_1,
    },
  });

  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "cashier@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "cashier@bakery.demo",
      fullName: "Гульнара Сатпаева",
      passwordHash,
      role: Role.CASHIER,
      regionId: region.id,
      locationId: LOC_STORE_1,
    },
  });

  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "warehouse@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "warehouse@bakery.demo",
      fullName: "Ержан Токтаров",
      passwordHash,
      role: Role.WAREHOUSE_STAFF,
      regionId: region.id,
      locationId: LOC_WAREHOUSE,
    },
  });

  const technologist = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "technologist@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "technologist@bakery.demo",
      fullName: "Сауле Жумабекова",
      passwordHash,
      role: Role.PRODUCTION_MANAGER,
      regionId: region.id,
      locationId: LOC_PRODUCTION,
    },
  });

  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "baker@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "baker@bakery.demo",
      fullName: "Марат Исаев",
      passwordHash,
      role: Role.PRODUCTION_STAFF,
      regionId: region.id,
      locationId: LOC_PRODUCTION,
    },
  });

  const products: {
    id: string;
    name: string;
    sku: string;
    unit: Unit;
    category: string;
    price: number;
  }[] = [
    { id: "prod-baguette", name: "Багет французский", sku: "BAG-001", unit: Unit.PCS, category: "Хлеб", price: 650 },
    { id: "prod-borodinsky", name: "Хлеб бородинский", sku: "BAG-002", unit: Unit.PCS, category: "Хлеб", price: 590 },
    { id: "prod-croissant", name: "Круассан классический", sku: "CRO-001", unit: Unit.PCS, category: "Выпечка", price: 450 },
    { id: "prod-croissant-choco", name: "Круассан шоколадный", sku: "CRO-002", unit: Unit.PCS, category: "Выпечка", price: 490 },
    { id: "prod-cake-honey", name: "Торт «Медовик»", sku: "CAKE-001", unit: Unit.PCS, category: "Торты", price: 8900 },
    { id: "prod-muffin-banana", name: "Кекс банановый", sku: "CAKE-002", unit: Unit.PCS, category: "Выпечка", price: 780 },
    { id: "prod-flour", name: "Мука пшеничная в/с", sku: "ING-001", unit: Unit.KG, category: "Сырьё", price: 320 },
    { id: "prod-butter", name: "Масло сливочное", sku: "ING-002", unit: Unit.KG, category: "Сырьё", price: 2400 },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, organizationId: org.id },
    });
  }

  const openingStock: { locationId: string; productId: string; quantity: number; minQuantity: number }[] = [
    { locationId: LOC_STORE_1, productId: "prod-baguette", quantity: 42, minQuantity: 15 },
    { locationId: LOC_STORE_1, productId: "prod-borodinsky", quantity: 30, minQuantity: 10 },
    { locationId: LOC_STORE_1, productId: "prod-croissant", quantity: 60, minQuantity: 20 },
    { locationId: LOC_STORE_1, productId: "prod-croissant-choco", quantity: 8, minQuantity: 15 },
    { locationId: LOC_STORE_1, productId: "prod-cake-honey", quantity: 5, minQuantity: 3 },
    { locationId: LOC_STORE_1, productId: "prod-muffin-banana", quantity: 25, minQuantity: 10 },
    { locationId: LOC_STORE_2, productId: "prod-baguette", quantity: 18, minQuantity: 15 },
    { locationId: LOC_STORE_2, productId: "prod-croissant", quantity: 12, minQuantity: 20 },
    { locationId: LOC_STORE_2, productId: "prod-cake-honey", quantity: 2, minQuantity: 3 },
    { locationId: LOC_WAREHOUSE, productId: "prod-flour", quantity: 480, minQuantity: 200 },
    { locationId: LOC_WAREHOUSE, productId: "prod-butter", quantity: 65, minQuantity: 50 },
    { locationId: LOC_PRODUCTION, productId: "prod-flour", quantity: 150, minQuantity: 50 },
    { locationId: LOC_PRODUCTION, productId: "prod-butter", quantity: 20, minQuantity: 10 },
  ];

  for (const s of openingStock) {
    await prisma.stockLevel.upsert({
      where: { locationId_productId: { locationId: s.locationId, productId: s.productId } },
      update: {},
      create: { ...s, organizationId: org.id },
    });

    const existingMovement = await prisma.stockMovement.findFirst({
      where: { locationId: s.locationId, productId: s.productId, reason: "Начальный остаток" },
    });
    if (!existingMovement) {
      await prisma.stockMovement.create({
        data: {
          organizationId: org.id,
          locationId: s.locationId,
          productId: s.productId,
          type: StockMovementType.RECEIPT,
          quantity: s.quantity,
          reason: "Начальный остаток",
          createdById: owner.id,
        },
      });
    }
  }

  const existingSales = await prisma.sale.count({ where: { organizationId: org.id } });
  if (existingSales === 0) {
    const sampleSales: { locationId: string; daysAgo: number; items: { productId: string; quantity: number; unitPrice: number }[] }[] = [
      {
        locationId: LOC_STORE_1,
        daysAgo: 0,
        items: [
          { productId: "prod-baguette", quantity: 3, unitPrice: 650 },
          { productId: "prod-croissant", quantity: 5, unitPrice: 450 },
        ],
      },
      {
        locationId: LOC_STORE_1,
        daysAgo: 1,
        items: [{ productId: "prod-cake-honey", quantity: 1, unitPrice: 8900 }],
      },
      {
        locationId: LOC_STORE_1,
        daysAgo: 2,
        items: [
          { productId: "prod-borodinsky", quantity: 2, unitPrice: 590 },
          { productId: "prod-muffin-banana", quantity: 4, unitPrice: 780 },
        ],
      },
      {
        locationId: LOC_STORE_2,
        daysAgo: 0,
        items: [{ productId: "prod-baguette", quantity: 2, unitPrice: 650 }],
      },
    ];

    for (const s of sampleSales) {
      const soldAt = new Date();
      soldAt.setDate(soldAt.getDate() - s.daysAgo);
      const totalAmount = s.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      await prisma.sale.create({
        data: {
          organizationId: org.id,
          locationId: s.locationId,
          soldAt,
          totalAmount,
          createdById: owner.id,
          items: {
            create: s.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              subtotal: i.quantity * i.unitPrice,
            })),
          },
        },
      });
    }
  }

  const recipes: {
    productId: string;
    yieldQuantity: number;
    items: { ingredientProductId: string; quantity: number }[];
  }[] = [
    {
      productId: "prod-croissant",
      yieldQuantity: 10,
      items: [
        { ingredientProductId: "prod-flour", quantity: 1.2 },
        { ingredientProductId: "prod-butter", quantity: 0.6 },
      ],
    },
    {
      productId: "prod-baguette",
      yieldQuantity: 8,
      items: [{ ingredientProductId: "prod-flour", quantity: 2 }],
    },
  ];

  for (const r of recipes) {
    await prisma.recipe.upsert({
      where: { productId: r.productId },
      update: {},
      create: {
        organizationId: org.id,
        productId: r.productId,
        yieldQuantity: r.yieldQuantity,
        items: { create: r.items },
      },
    });
  }

  const existingBatches = await prisma.productionBatch.count({ where: { organizationId: org.id } });
  if (existingBatches === 0) {
    const croissantRecipe = await prisma.recipe.findUnique({ where: { productId: "prod-croissant" } });
    if (croissantRecipe) {
      await prisma.productionBatch.create({
        data: {
          organizationId: org.id,
          locationId: LOC_PRODUCTION,
          recipeId: croissantRecipe.id,
          status: ProductionBatchStatus.PLANNED,
          plannedQuantity: 30,
          createdById: technologist.id,
        },
      });
    }
  }

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
