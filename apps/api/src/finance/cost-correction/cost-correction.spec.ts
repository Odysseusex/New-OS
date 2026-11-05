import { PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../../test/support/isolated-org";
import { buildServices } from "../../../test/support/services";
import { monthOf } from "../../common/reporting-period";
import { CostCorrectionService } from "./cost-correction.service";

// The month-end correction read from real documents: a purchase order received,
// its price corrected afterwards, a batch of bread baked from it and sold at
// today's recipe. Own throwaway organization; the month is the current one.

const prisma = new PrismaService();
const services = buildServices(prisma);
const correction = new CostCorrectionService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let flourId: string;
let breadId: string;
let recipeId: string;
let supplierId: string;
const { year, month } = monthOf(new Date());

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "cost-correction");
  const { organizationId } = org;
  flourId = (await prisma.product.create({ data: { organizationId, name: "Мука", sku: "C-ING", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 } })).id;
  breadId = (await prisma.product.create({ data: { organizationId, name: "Хлеб", sku: "C-PRD", unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 500 } })).id;
  recipeId = (
    await prisma.recipe.create({ data: { organizationId, productId: breadId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 5 }] } } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Мельница" } })).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("month-end cost correction from the documents", () => {
  it("is empty while every stamp already follows the average", async () => {
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 400 }] } as never);
    await services.procurement.receive(org.user, po.id);
    const preview = await correction.preview(org.organizationId, year, month);
    expect(preview.status).toBe("PREVIEW");
    expect(preview.totalCorrection).toBe(0);
  });

  it("bread is sold at what its batch cost: a later flour price change leaves nothing to correct", async () => {
    // A batch of 10 loaves from 5 kg at 400: 200 a loaf.
    const batch = await services.production.create(org.user, { recipeId, plannedQuantity: 10, locationId: org.storeId } as never);
    await services.production.start(org.user, batch.id);
    await services.production.complete(org.user, batch.id, { actualQuantity: 10 } as never);
    // Flour gets dearer: 5 kg left at 400 + 10 kg at 600 → 533.33 a kg. Today's recipe would say
    // 266.67 a loaf, but the loaves were baked at 200 and are sold at the average of their batch.
    const dear = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 600 }] } as never);
    await services.procurement.receive(org.user, dear.id);
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 4, unitPrice: 500 }] } as never);
    const stamped = (await prisma.saleItem.findFirstOrThrow({ where: { productId: breadId, sale: { organizationId: org.organizationId } } })).unitCost!.toNumber();
    expect(stamped).toBe(200);

    const preview = await correction.preview(org.organizationId, year, month);
    const bread = preview.lines.find((l) => l.productId === breadId);
    expect(bread?.cogsStamped ?? 800).toBe(800);
    expect(bread?.cogsRecomputed ?? 800).toBe(800);
    expect(preview.cogsCorrection).toBe(0);
  });

  it("a purchase price corrected after the fact flows through the batch into the bread sold", async () => {
    const first = await prisma.purchaseOrder.findFirstOrThrow({ where: { organizationId: org.organizationId }, orderBy: { orderedAt: "asc" }, include: { items: true } });
    // 5 of its 10 kg went into the batch; the other 5 are still on the shelf, so the correction is accepted.
    await services.procurement.revise(org.user, first.id, { items: [{ itemId: first.items[0].id, quantity: 10, unitCost: 300 }], reason: "Цена в накладной 300" });
    const preview = await correction.preview(org.organizationId, year, month);
    const flour = preview.lines.find((l) => l.productId === flourId)!;
    // The batch's 5 kg: stamped at 400, really 300.
    expect(flour.productionStamped).toBe(2000);
    expect(flour.productionRecomputed).toBe(1500);
    const bread = preview.lines.find((l) => l.productId === breadId)!;
    // A loaf really cost 150: 4 sold = 600.
    expect(bread.cogsRecomputed).toBe(600);
    expect(preview.totalCorrection).toBeCloseTo(600 - bread.cogsStamped, 2);
  });
});
