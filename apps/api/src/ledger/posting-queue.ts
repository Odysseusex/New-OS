import { AsyncLocalStorage } from "async_hooks";
import type { Prisma } from "@prisma/client";
import type { ProjectionScope } from "../finance/events/scope";

// Posting to the general ledger used to run at every hook inside the business
// transaction: a sale posted its own events AND each of its cash movements,
// each posting a dozen queries. On a database that is a few tens of
// milliseconds away that added up to more than the transaction's time limit,
// and the sale failed with "Transaction already closed".
//
// Now a hook only RECORDS what it wants posted. The transaction wrapper in
// PrismaService runs ONE posting for the whole transaction, as its last step and
// on the same transaction — still atomic with the operation, but a fixed handful
// of queries however many documents the operation wrote.
//
// This module deliberately imports nothing from the ledger or from PrismaService
// (only types), so PrismaService can depend on it without a cycle; the flusher
// registers itself when event-posting is loaded.

export interface PendingPosting {
  organizationId: string;
  actorId: string;
  scope: ProjectionScope;
}

export interface PostingQueue {
  byOrganization: Map<string, PendingPosting>;
}

export const postingQueueStorage = new AsyncLocalStorage<PostingQueue>();

export type PostingFlusher = (tx: Prisma.TransactionClient, pending: PendingPosting[]) => Promise<void>;
let flusher: PostingFlusher | null = null;
export const setPostingFlusher = (fn: PostingFlusher) => {
  flusher = fn;
};

const FIELDS: (keyof ProjectionScope)[] = [
  "saleIds",
  "saleReturnIds",
  "expenseIds",
  "stockMovementIds",
  "cashMovementIds",
  "purchaseOrderIds",
  "invoiceIds",
  "depreciationEntryIds",
  "fixedAssetIds",
];

// True when a queue is open (we are inside a wrapped transaction) and the
// request was recorded for the end of it.
export function enqueuePosting(args: PendingPosting): boolean {
  const queue = postingQueueStorage.getStore();
  if (!queue) return false;
  const existing = queue.byOrganization.get(args.organizationId);
  if (!existing) {
    queue.byOrganization.set(args.organizationId, { organizationId: args.organizationId, actorId: args.actorId, scope: mergeScopes({}, args.scope) });
    return true;
  }
  existing.scope = mergeScopes(existing.scope, args.scope);
  return true;
}

function mergeScopes(a: ProjectionScope, b: ProjectionScope): ProjectionScope {
  const out: ProjectionScope = {};
  for (const f of FIELDS) {
    const merged = [...new Set([...(a[f] ?? []), ...(b[f] ?? [])])];
    // A family that was named (even with no ids) stays named: a scoped
    // projection treats an absent family as "nothing", never as "everything".
    if (merged.length > 0 || a[f] !== undefined || b[f] !== undefined) out[f] = merged;
  }
  return out;
}

// Runs the open queue's postings on `tx`. Called by the transaction wrapper.
export async function flushPostingQueue(tx: Prisma.TransactionClient, queue: PostingQueue): Promise<void> {
  const pending = [...queue.byOrganization.values()];
  queue.byOrganization.clear();
  if (pending.length === 0 || !flusher) return;
  await flusher(tx, pending);
}
