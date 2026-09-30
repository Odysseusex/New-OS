import { Global, Injectable, Module } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ProductType } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { resolveProductUnitCosts } from "../common/product-costs";

// Which rule produced a unit cost. These name CURRENT SYSTEM BEHAVIOUR, not an
// approved accounting policy — the inventory cost-flow method (decision D2)
// is not approved, and nothing here pretends otherwise.
export type CurrentCostBasis = "RECIPE_CURRENT" | "PURCHASE_AVERAGE_CURRENT" | "RAW_MATERIAL_PRICE";

export interface UnitCost {
  unitCost: number;
  basis: CurrentCostBasis;
}

export const COSTING_METHOD_LABEL_RU = "текущий расчёт (политика не утверждена)";

type Client = Prisma.TransactionClient | PrismaService;

// THE single valuation interface. P&L cost of goods, inventory valuation,
// stocktake differences, balance-sheet inventory and every cost snapshot go
// through here, so two parts of the app can never value the same loaf two
// different ways.
//
// Current behaviour (unchanged by this class, only centralised):
//   RAW_MATERIAL  → Product.price (for raw materials that field IS the cost)
//   FINISHED_GOOD → active recipe cost, else weighted-average purchase cost
//   neither       → absent from the map = unknown, never zero
@Injectable()
export class CostingService {
  constructor(private prisma: PrismaService) {}

  get methodLabel(): string {
    return COSTING_METHOD_LABEL_RU;
  }

  async currentUnitCosts(organizationId: string, client: Client = this.prisma): Promise<Map<string, UnitCost>> {
    const [products, resolved, recipeProductIds] = await Promise.all([
      client.product.findMany({ where: { organizationId }, select: { id: true, type: true, price: true } }),
      resolveProductUnitCosts(client, organizationId),
      client.recipe.findMany({ where: { organizationId, isActive: true }, select: { productId: true } }),
    ]);
    const hasRecipe = new Set(recipeProductIds.map((r) => r.productId));
    const out = new Map<string, UnitCost>();
    for (const product of products) {
      if (product.type === ProductType.RAW_MATERIAL) {
        out.set(product.id, { unitCost: product.price.toNumber(), basis: "RAW_MATERIAL_PRICE" });
        continue;
      }
      const cost = resolved.get(product.id);
      if (cost === undefined) continue;
      out.set(product.id, {
        unitCost: cost,
        basis: hasRecipe.has(product.id) ? "RECIPE_CURRENT" : "PURCHASE_AVERAGE_CURRENT",
      });
    }
    return out;
  }
}

@Global()
@Module({ providers: [CostingService], exports: [CostingService] })
export class CostingModule {}
