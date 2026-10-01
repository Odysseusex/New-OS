import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

// Either the connection or a transaction on it: the builders only use model
// delegates, so the ledger can project inside the transaction that is posting.
export type DbClient = PrismaService | Prisma.TransactionClient;

// Restricts a projection to named source documents. Absent = everything (the
// behaviour every existing caller relies on). Present = ONLY the listed
// families, and only the listed ids — a family left out yields nothing, and the
// declared opening position is never part of a scoped projection.
export interface ProjectionScope {
  saleIds?: string[];
  saleReturnIds?: string[];
  expenseIds?: string[];
  stockMovementIds?: string[];
  cashMovementIds?: string[];
  purchaseOrderIds?: string[];
  invoiceIds?: string[];
  depreciationEntryIds?: string[];
  fixedAssetIds?: string[];
}

// undefined = unscoped (take all); an array (possibly empty) = take exactly those.
export const scoped = (scope: ProjectionScope | undefined, key: keyof ProjectionScope): string[] | undefined =>
  scope === undefined ? undefined : scope[key] ?? [];

