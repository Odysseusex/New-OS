import { CallHandler, ExecutionContext, Injectable, NestInterceptor, NotFoundException } from "@nestjs/common";
import { Observable } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";

// One lock for every signed-in request: an id sent in the address, the query or the body
// (locationId, productId, accountId, …) that belongs to ANOTHER organization is refused
// before the handler runs.
//
// Each service checks the document it is asked about, but a reference inside a request was
// easy to miss: a stock receipt took any `locationId` and wrote into another organization's
// shelf (found in the security review of 25.11.2026 — the sandbox is a second organization
// on the same server). Rather than trust ~180 fields one by one, the rule lives here.
//
// Only what exists under another organization and not under the caller's is refused; an id
// found nowhere (a typo, a special value) is left to the handler, which answers as before.

type Finder = (ids: string[]) => Promise<{ id: string; organizationId: string }[]>;

@Injectable()
export class OrgReferenceInterceptor implements NestInterceptor {
  private readonly finders: Record<string, Finder>;

  constructor(private prisma: PrismaService) {
    const by =
      (model: { findMany: (args: { where: { id: { in: string[] } }; select: { id: true; organizationId: true } }) => Promise<{ id: string; organizationId: string }[]> }): Finder =>
      (ids) =>
        model.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true } });
    const p = this.prisma;
    this.finders = {
      location: by(p.location),
      product: by(p.product),
      cashAccount: by(p.cashAccount),
      ledgerAccount: by(p.ledgerAccount),
      category: by(p.category),
      financeCategory: by(p.financeCategory),
      customer: by(p.customer),
      supplier: by(p.supplier),
      member: by(p.loyaltyMember),
      direction: by(p.direction),
      vehicle: by(p.vehicle),
      user: by(p.user),
      employee: by(p.employee),
      recipe: by(p.recipe),
      sale: by(p.sale),
      purchaseOrder: by(p.purchaseOrder),
      crmOrder: by(p.crmOrder),
      invoice: by(p.invoice),
      batch: by(p.productionBatch),
      classificationBatch: by(p.classificationBatch),
      region: by(p.region),
      expense: by(p.expense),
      movement: by(p.stockMovement),
      scenario: by(p.financialModelScenario),
    };
  }

  // Which tables a field name may point into. A name not listed is not checked here.
  private modelsFor(key: string): string[] {
    const k = key.toLowerCase();
    if (!k.endsWith("id") && !k.endsWith("ids")) return [];
    if (k.includes("location")) return ["location"];
    if (k.includes("product")) return ["product"];
    if (k.includes("account")) return ["cashAccount", "ledgerAccount"];
    if (k.includes("category") || k === "parentid") return ["category", "financeCategory", "ledgerAccount"];
    if (k.includes("customer")) return ["customer"];
    if (k.includes("supplier")) return ["supplier"];
    if (k.includes("member") || k === "primaryid" || k === "duplicateid") return ["member"];
    if (k.includes("direction")) return ["direction"];
    if (k.includes("vehicle")) return ["vehicle"];
    if (k === "userid" || k === "driverid" || k === "cashierid" || k === "actorid" || k === "employeeid") return ["user", "employee"];
    if (k === "recipeid") return ["recipe"];
    if (k === "saleid") return ["sale"];
    if (k === "purchaseorderid" || k === "orderid" || k === "crmorderid") return ["purchaseOrder", "crmOrder"];
    if (k === "invoiceid") return ["invoice"];
    if (k === "batchids" || k === "batchid") return ["batch", "classificationBatch"];
    if (k === "regionid") return ["region"];
    if (k.includes("expense")) return ["expense"];
    if (k === "movementids") return ["movement"];
    if (k === "scenarioids") return ["scenario"];
    return [];
  }

  private collect(value: unknown, wanted: Map<string, Set<string>>, depth = 0, budget = { left: 5000 }): void {
    if (!value || typeof value !== "object" || depth > 6) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (budget.left-- <= 0) return;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        this.collect(v, wanted, depth + 1, budget);
        continue;
      }
      const models = this.modelsFor(key);
      const list = Array.isArray(v) ? v : [v];
      if (models.length) {
        for (const item of list) {
          if (typeof item !== "string" || item.length < 3 || item.length > 64) continue;
          for (const model of models) {
            if (!wanted.has(model)) wanted.set(model, new Set());
            wanted.get(model)!.add(item);
          }
        }
      }
      if (Array.isArray(v)) for (const item of v) this.collect(item, wanted, depth + 1, budget);
    }
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser; body?: unknown; query?: unknown; params?: unknown }>();
    const organizationId = request.user?.organizationId;
    if (!organizationId) return next.handle();

    const wanted = new Map<string, Set<string>>();
    this.collect(request.params, wanted);
    this.collect(request.query, wanted);
    this.collect(request.body, wanted);
    if (!wanted.size) return next.handle();

    // The same id may be looked for in several tables (`accountId`: a cash account or a ledger
    // account). It is refused only if it exists somewhere else and nowhere under the caller.
    const mine = new Set<string>();
    const foreign = new Set<string>();
    await Promise.all(
      [...wanted].map(async ([model, ids]) => {
        for (const row of await this.finders[model]([...ids])) (row.organizationId === organizationId ? mine : foreign).add(row.id);
      }),
    );
    for (const id of foreign) if (!mine.has(id)) throw new NotFoundException("Запись не найдена");
    return next.handle();
  }
}
