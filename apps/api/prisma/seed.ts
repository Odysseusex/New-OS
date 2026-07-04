import {
  PrismaClient,
  Role,
  LocationType,
  Unit,
  StockMovementType,
  ProductionBatchStatus,
  ExpenseCategory,
} from "@prisma/client";
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

  const driver = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "driver@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "driver@bakery.demo",
      fullName: "Бекзат Нурланов",
      passwordHash,
      role: Role.DRIVER,
      regionId: region.id,
    },
  });

  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "hr@bakery.demo" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "hr@bakery.demo",
      fullName: "Мадина Ахметова",
      passwordHash,
      role: Role.HR_MANAGER,
      regionId: region.id,
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

  const supplier = await prisma.supplier.upsert({
    where: { id: "supplier-mill" },
    update: {},
    create: {
      id: "supplier-mill",
      organizationId: org.id,
      name: "ТОО «Алматинский мукомольный завод»",
      phone: "+7 727 123 4567",
      email: "sales@almaty-mill.kz",
      notes: "Основной поставщик муки и сахара",
    },
  });

  const existingOrders = await prisma.purchaseOrder.count({ where: { organizationId: org.id } });
  if (existingOrders === 0) {
    const items = [
      { productId: "prod-flour", quantity: 200, unitCost: 300, subtotal: 200 * 300 },
      { productId: "prod-butter", quantity: 30, unitCost: 2300, subtotal: 30 * 2300 },
    ];
    const totalCost = items.reduce((sum, i) => sum + i.subtotal, 0);

    await prisma.purchaseOrder.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        locationId: LOC_WAREHOUSE,
        totalCost,
        createdById: owner.id,
        items: { create: items },
      },
    });
  }

  const vehicle = await prisma.vehicle.upsert({
    where: { id: "vehicle-gazelle-1" },
    update: {},
    create: {
      id: "vehicle-gazelle-1",
      organizationId: org.id,
      name: "Газель",
      plateNumber: "A123 БВ 05",
    },
  });

  const existingRoutes = await prisma.deliveryRoute.count({ where: { organizationId: org.id } });
  if (existingRoutes === 0) {
    await prisma.deliveryRoute.create({
      data: {
        organizationId: org.id,
        originLocationId: LOC_PRODUCTION,
        vehicleId: vehicle.id,
        driverId: driver.id,
        createdById: owner.id,
        stops: {
          create: [
            {
              destinationLocationId: LOC_STORE_1,
              sequence: 1,
              items: {
                create: [{ productId: "prod-croissant", quantity: 10 }],
              },
            },
            {
              destinationLocationId: LOC_STORE_2,
              sequence: 2,
              items: {
                create: [{ productId: "prod-baguette", quantity: 5 }],
              },
            },
          ],
        },
      },
    });
  }

  const existingExpenses = await prisma.expense.count({ where: { organizationId: org.id } });
  if (existingExpenses === 0) {
    const expenses: {
      locationId: string | null;
      category: ExpenseCategory;
      amount: number;
      description: string;
      daysAgo: number;
    }[] = [
      { locationId: LOC_STORE_1, category: ExpenseCategory.RENT, amount: 350000, description: "Аренда за месяц", daysAgo: 3 },
      { locationId: LOC_STORE_2, category: ExpenseCategory.RENT, amount: 280000, description: "Аренда за месяц", daysAgo: 3 },
      { locationId: LOC_PRODUCTION, category: ExpenseCategory.UTILITIES, amount: 95000, description: "Электричество и вода", daysAgo: 2 },
      { locationId: null, category: ExpenseCategory.SALARY, amount: 1800000, description: "Зарплата за месяц", daysAgo: 1 },
      { locationId: null, category: ExpenseCategory.MARKETING, amount: 60000, description: "Реклама в соцсетях", daysAgo: 5 },
      { locationId: LOC_WAREHOUSE, category: ExpenseCategory.LOGISTICS, amount: 45000, description: "Топливо для доставки", daysAgo: 1 },
    ];

    for (const e of expenses) {
      const incurredOn = new Date();
      incurredOn.setDate(incurredOn.getDate() - e.daysAgo);

      await prisma.expense.create({
        data: {
          organizationId: org.id,
          locationId: e.locationId,
          category: e.category,
          amount: e.amount,
          description: e.description,
          incurredOn,
          createdById: owner.id,
        },
      });
    }
  }

  const cashier = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId: org.id, email: "cashier@bakery.demo" } },
  });
  const manager = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId: org.id, email: "manager@bakery.demo" } },
  });

  const existingShifts = await prisma.shift.count({ where: { organizationId: org.id } });
  if (existingShifts === 0 && cashier && manager) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(18, 0, 0, 0);

    await prisma.shift.create({
      data: {
        organizationId: org.id,
        locationId: LOC_STORE_1,
        userId: cashier.id,
        startsAt: tomorrow,
        endsAt: tomorrowEnd,
        createdById: manager.id,
      },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(9, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(17, 30, 0, 0);

    await prisma.timeEntry.create({
      data: {
        organizationId: org.id,
        locationId: LOC_STORE_1,
        userId: cashier.id,
        clockInAt: yesterday,
        clockOutAt: yesterdayEnd,
      },
    });
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
