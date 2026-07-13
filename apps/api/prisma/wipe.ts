// Deletes every row of business data while leaving the schema, migrations,
// and _prisma_migrations history untouched. Used once when moving an
// organization from demo data to real day-one data.
//
// Safety gate: requires CONFIRM_WIPE=yes so it can never run by accident.
//
//   CONFIRM_WIPE=yes DATABASE_URL="..." npx ts-node prisma/wipe.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_WIPE !== "yes") {
    console.error("Refusing to run: set CONFIRM_WIPE=yes to confirm this deletes all data.");
    process.exit(1);
  }

  // Children before parents, respecting every foreign key in schema.prisma.
  const steps: [string, () => Promise<{ count: number }>][] = [
    ["stockMovement", () => prisma.stockMovement.deleteMany()],
    ["saleItem", () => prisma.saleItem.deleteMany()],
    ["sale", () => prisma.sale.deleteMany()],
    ["customer", () => prisma.customer.deleteMany()],
    ["routeStopItem", () => prisma.routeStopItem.deleteMany()],
    ["routeStop", () => prisma.routeStop.deleteMany()],
    ["deliveryRoute", () => prisma.deliveryRoute.deleteMany()],
    ["vehicle", () => prisma.vehicle.deleteMany()],
    ["purchaseOrderItem", () => prisma.purchaseOrderItem.deleteMany()],
    ["purchaseOrder", () => prisma.purchaseOrder.deleteMany()],
    ["supplier", () => prisma.supplier.deleteMany()],
    ["productionBatch", () => prisma.productionBatch.deleteMany()],
    ["recipeItem", () => prisma.recipeItem.deleteMany()],
    ["recipe", () => prisma.recipe.deleteMany()],
    ["stockLevel", () => prisma.stockLevel.deleteMany()],
    ["product", () => prisma.product.deleteMany()],
    ["expense", () => prisma.expense.deleteMany()],
    ["timeEntry", () => prisma.timeEntry.deleteMany()],
    ["shift", () => prisma.shift.deleteMany()],
    ["user", () => prisma.user.deleteMany()],
    ["location", () => prisma.location.deleteMany()],
    ["region", () => prisma.region.deleteMany()],
    ["organization", () => prisma.organization.deleteMany()],
  ];

  for (const [name, run] of steps) {
    const { count } = await run();
    console.log(`${name}: deleted ${count}`);
  }

  console.log("Wipe complete. Schema, migrations and app code are untouched.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
