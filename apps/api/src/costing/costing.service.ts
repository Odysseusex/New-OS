import { Global, Injectable, Module } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ACTIVE_PRODUCTION_COST_COMPONENTS,
  CostBasis,
  COSTING_METHOD_LABEL_RU,
  PRODUCTION_COST_COMPONENT_LABELS_RU,
  ProductionCostComponent,
  ProductionCostComponentStatusDto,
  ProductType,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { resolveProductUnitCosts } from "../common/product-costs";
import { round2, round4 } from "../common/money";

export interface UnitCost {
  unitCost: number;
  basis: CostBasis;
}

// What gets stamped onto a movement / sale line / return line.
export interface CostSnapshotFields {
  unitCost: number | null;
  costBasis: string | null;
}

export const NO_COST_SNAPSHOT: CostSnapshotFields = { unitCost: null, costBasis: null };

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
//
// Snapshots (unitCost/costBasis on movements and sale lines) are taken from
// this same interface at the moment of the event and are then immutable:
// history is read from the snapshot, never re-derived from today's prices.
@Injectable()
export class CostingService {
  constructor(private prisma: PrismaService) {}

  get methodLabel(): string {
    return COSTING_METHOD_LABEL_RU;
  }

  async currentUnitCosts(
    organizationId: string,
    client: Client = this.prisma,
    productIds?: string[],
  ): Promise<Map<string, UnitCost>> {
    const idFilter = productIds ? { id: { in: productIds } } : {};
    const [products, resolved, recipeProductIds] = await Promise.all([
      client.product.findMany({ where: { organizationId, ...idFilter }, select: { id: true, type: true, price: true } }),
      resolveProductUnitCosts(client, organizationId, productIds),
      client.recipe.findMany({
        where: { organizationId, isActive: true, ...(productIds ? { productId: { in: productIds } } : {}) },
        select: { productId: true },
      }),
    ]);
    const hasRecipe = new Set(recipeProductIds.map((r) => r.productId));
    const out = new Map<string, UnitCost>();
    for (const product of products) {
      if (product.type === ProductType.RAW_MATERIAL) {
        out.set(product.id, { unitCost: product.price.toNumber(), basis: CostBasis.RAW_MATERIAL_PRICE });
        continue;
      }
      const cost = resolved.get(product.id);
      if (cost === undefined) continue;
      out.set(product.id, {
        unitCost: cost,
        basis: hasRecipe.has(product.id) ? CostBasis.RECIPE_CURRENT : CostBasis.PURCHASE_AVERAGE_CURRENT,
      });
    }
    return out;
  }

  // Costs for exactly these products, ready to be written onto a row. Products
  // with no known cost are simply absent — callers store NO_COST_SNAPSHOT.
  async snapshotCosts(organizationId: string, productIds: string[], client: Client = this.prisma) {
    if (productIds.length === 0) return new Map<string, UnitCost>();
    return this.currentUnitCosts(organizationId, client, [...new Set(productIds)]);
  }

  fields(cost: UnitCost | undefined | null): CostSnapshotFields {
    if (!cost) return NO_COST_SNAPSHOT;
    return { unitCost: round4(cost.unitCost), costBasis: cost.basis };
  }

  // Value of a quantity at a snapshotted unit cost; null when there is no cost.
  static value(unitCost: number | null | undefined, quantity: number): number | null {
    if (unitCost === null || unitCost === undefined) return null;
    return round2(unitCost * quantity);
  }

  // The full component list for a batch — INGREDIENT with its amount when
  // known, everything else explicitly NOT_CONFIGURED (never zero, never
  // silently missing).
  static componentStatuses(ingredientAmount: number | null): ProductionCostComponentStatusDto[] {
    return Object.values(ProductionCostComponent).map((component) => {
      const active = ACTIVE_PRODUCTION_COST_COMPONENTS.includes(component);
      return {
        component,
        label: PRODUCTION_COST_COMPONENT_LABELS_RU[component],
        status: active ? "ACTIVE" : "NOT_CONFIGURED",
        amount: active ? ingredientAmount : null,
      };
    });
  }
}

@Global()
@Module({ providers: [CostingService], exports: [CostingService] })
export class CostingModule {}
