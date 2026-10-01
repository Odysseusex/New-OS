import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { flushPostingQueue, postingQueueStorage } from "../ledger/posting-queue";

// An interactive transaction gets 5 seconds by default. The database is not next
// door (a small hosted instance a network hop away), and a sale is dozens of
// round trips; a limit that tight turns a slow moment into a failed sale. A
// transaction that really hangs is still cut off, just not after five seconds.
const DEFAULT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // The callback form is wrapped so that general-ledger postings requested by the
  // work inside it run ONCE, as the transaction's last step and on the same
  // transaction (see ledger/posting-queue.ts). The array form is untouched.
  // The overloads repeat the base client's so callers keep their types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<any>;
  $transaction<R>(
    fn: (prisma: Prisma.TransactionClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<R>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async $transaction(arg: any, options?: any): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (super.$transaction as any).bind(this);
    if (typeof arg !== "function") return base(arg, options);
    return base(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any) => {
        const queue = { byOrganization: new Map() };
        return postingQueueStorage.run(queue, async () => {
          const result = await arg(tx);
          await flushPostingQueue(tx, queue);
          return result;
        });
      },
      { ...DEFAULT_TRANSACTION_OPTIONS, ...(options ?? {}) },
    );
  }
}
