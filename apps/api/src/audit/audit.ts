import { Prisma } from "@prisma/client";

// Every audited action, named `<entity>.<verb>`, grouped by the domain that
// writes it. A closed list so a typo cannot create an action nobody filters
// for; each domain's spec asserts its own group is fully exercised.
export const AUDIT_ACTION_GROUPS = {
  core: [
    "user.create",
    "user.update",
    "user.archive",
    "user.restore",
    "product.update",
    "product.delete",
    "product.forceDelete",
    "product.locationPrice.set",
    "product.locationPrice.clear",
    "financeCategory.create",
    "financeCategory.update",
    "financeCategory.costBehavior",
    "financeCategory.archive",
    "financeCategory.restore",
    "financeCategory.delete",
    "cashAccount.create",
    "cashAccount.update",
    "cashAccount.setDefault",
    "cashAccount.archive",
    "cashAccount.restore",
    "expense.confirm",
    "expense.cancel",
    "financeSetup.reconcileInvoices",
    "financeSetup.complete",
    "purchaseOrder.receive",
    "purchaseOrder.cancel",
    "invoice.confirm",
    "invoice.cancel",
    "productionBatch.cancel",
    "productionBatch.delete",
    "accountingPolicy.update",
  ],
  classification: ["financeCategory.classification", "cashAccount.adjust"],
  fixedAssets: ["fixedAsset.register", "fixedAsset.terms", "fixedAsset.dispose", "depreciation.run"],
  periods: ["period.close", "period.reopen"],
  procurement: ["procurement.cutover", "purchaseOrder.payment", "purchaseOrder.paymentReverse"],
  master: [
    "supplier.update", "supplier.archive", "supplier.restore", "supplier.delete",
    "customer.update", "customer.archive", "customer.restore", "customer.delete",
    "category.update", "category.archive", "category.restore", "category.delete",
    "location.update", "location.archive", "location.restore", "location.delete",
    "vehicle.update", "vehicle.archive", "vehicle.restore", "vehicle.delete",
    "employee.update", "employee.archive", "employee.restore", "employee.delete",
    "recipe.create", "recipe.update", "recipe.archive", "recipe.restore", "recipe.delete",
    "product.archive", "product.restore",
  ],
  stocktake: ["stocktake.create", "stocktake.submit", "stocktake.reopen", "stocktake.approve", "stocktake.cancel"],
} as const;

type Groups = typeof AUDIT_ACTION_GROUPS;
export type AuditAction = Groups[keyof Groups][number];
export const AUDIT_ACTIONS: readonly AuditAction[] = Object.values(AUDIT_ACTION_GROUPS).flat();

export interface AuditEntry {
  organizationId: string;
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

// Takes a TRANSACTION client on purpose: an audit entry must commit or roll
// back together with the change it describes. Passing the root PrismaService
// compiles (it satisfies the same interface), so every call site in this repo
// is reviewed to run inside `$transaction(async (tx) => …)`.
export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: toAuditJson(entry.before),
      after: toAuditJson(entry.after),
      reason: entry.reason ?? null,
    },
  });
}

// Copies only the named fields — the whitelist is what keeps secrets such as
// password hashes out of the log.
export function auditFields<T extends object, K extends keyof T>(source: T | null | undefined, fields: readonly K[]) {
  if (!source) return null;
  const picked: Partial<Pick<T, K>> = {};
  for (const field of fields) picked[field] = source[field];
  return picked;
}

// Decimals become strings and Dates ISO strings (their own toJSON), so the
// stored value is exactly what was in the row, with no float rounding.
function toAuditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// One audited change: the work and its audit entry commit or roll back together.
// `work` returns the result plus what to record as the row's state afterwards.
export async function audited<T>(
  prisma: { $transaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> },
  meta: Omit<AuditEntry, "after">,
  work: (tx: Prisma.TransactionClient) => Promise<{ result: T; after?: unknown }>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const { result, after } = await work(tx);
    await recordAudit(tx, { ...meta, after });
    return result;
  });
}
