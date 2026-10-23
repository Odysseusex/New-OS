import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Writable } from "stream";
import { once } from "events";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { DeferredReference, EXCLUDED_TABLES, EXPORT_FORMAT, EXPORT_VERSION, ForeignKeyEdge, orderTables, REDACTED_COLUMNS } from "./backup-format";

// «Скачать все данные»: the whole database as one JSON file, for the owner to keep. It is
// read inside ONE repeatable-read snapshot, so every table is from the same instant, and
// streamed in pages (a table is never held in memory whole). Read-only: nothing here
// writes to the business tables. The file holds no password hashes.

const PAGE = 1000;
// The snapshot stays open while the file is written; a few minutes is generous for this size.
const EXPORT_TRANSACTION = { maxWait: 10_000, timeout: 10 * 60_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface ExportSummary {
  tables: number;
  rows: number;
  bytes: number;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private prisma: PrismaService) {}

  async status(organizationId: string): Promise<{ lastExportAt: string | null; lastExportBy: string | null }> {
    const last = await this.prisma.auditLog.findFirst({
      where: { organizationId, action: "dataExport.download" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, actorId: true },
    });
    if (!last) return { lastExportAt: null, lastExportBy: null };
    const actor = last.actorId ? await this.prisma.user.findUnique({ where: { id: last.actorId }, select: { fullName: true } }) : null;
    return { lastExportAt: last.createdAt.toISOString(), lastExportBy: actor?.fullName ?? null };
  }

  // Writes the file to `out`. `aborted` lets the caller stop early when the browser went away.
  async writeExport(user: AuthenticatedUser, out: Writable, aborted: () => boolean = () => false): Promise<ExportSummary> {
    // Recorded BEFORE anything is read: a download that starts is a download that was made.
    await this.prisma.$transaction(async (tx) => {
      await recordAudit(tx, { organizationId: user.organizationId, actorId: user.id, action: "dataExport.download", entityType: "DataExport", entityId: "all" });
    });

    const summary: ExportSummary = { tables: 0, rows: 0, bytes: 0 };
    const write = async (text: string) => {
      summary.bytes += Buffer.byteLength(text);
      if (!out.write(text)) await once(out, "drain");
    };

    await this.prisma.$transaction(async (tx) => {
      const { tables, order, deferred } = await this.layout(tx);
      const migrations = await tx.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      await write(
        `{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${EXPORT_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())},` +
          `"migrations":${JSON.stringify(migrations.map((m) => m.migration_name))},"order":${JSON.stringify(order)},"deferred":${JSON.stringify(deferred)},"tables":{`,
      );
      let firstTable = true;
      for (const table of order) {
        if (aborted()) throw new Error("Скачивание прервано");
        await write(`${firstTable ? "" : ","}${JSON.stringify(table)}:[`);
        firstTable = false;
        let firstRow = true;
        const redacted = [...(REDACTED_COLUMNS[table] ?? [])];
        const hasId = tables.get(table)!.hasId;
        let last: string | null = null;
        for (;;) {
          const rows = await this.page(tx, table, redacted, hasId, last);
          if (rows.length === 0) break;
          await write((firstRow ? "" : ",") + rows.map((r) => r.j).join(","));
          firstRow = false;
          summary.rows += rows.length;
          if (!hasId || rows.length < PAGE) break;
          last = rows[rows.length - 1].id;
        }
        await write("]");
        summary.tables += 1;
      }
      await write(`},"complete":true}`);
    }, EXPORT_TRANSACTION);

    this.logger.log(`Data export by ${user.email}: ${summary.tables} tables, ${summary.rows} rows, ${(summary.bytes / 1024 / 1024).toFixed(1)} MB`);
    return summary;
  }

  // Every table of the schema except the excluded ones, parents before children.
  private async layout(tx: Prisma.TransactionClient): Promise<{ tables: Map<string, { hasId: boolean }>; order: string[]; deferred: DeferredReference[] }> {
    const cols = await tx.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT c.table_name, c.column_name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`;
    const tables = new Map<string, { hasId: boolean }>();
    for (const c of cols) {
      if (EXCLUDED_TABLES.has(c.table_name)) continue;
      const entry = tables.get(c.table_name) ?? { hasId: false };
      if (c.column_name === "id") entry.hasId = true;
      tables.set(c.table_name, entry);
    }
    const edges = await tx.$queryRaw<ForeignKeyEdge[]>`
      SELECT child.relname AS child, parent.relname AS parent,
             array_agg(a.attname ORDER BY a.attnum) AS columns,
             -- A column a CHECK constraint speaks about cannot be left empty even for a moment.
             bool_and(NOT a.attnotnull AND NOT EXISTS (
               SELECT 1 FROM pg_constraint c WHERE c.conrelid = k.conrelid AND c.contype = 'c' AND a.attnum = ANY (c.conkey)
             )) AS nullable
        FROM pg_constraint k
        JOIN pg_class child ON child.oid = k.conrelid
        JOIN pg_class parent ON parent.oid = k.confrelid
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
       WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
       GROUP BY k.oid, child.relname, parent.relname`;
    const { order, deferred, cyclic } = orderTables([...tables.keys()], edges);
    if (cyclic.length > 0) throw new Error(`Таблицы со взаимными обязательными ссылками, выгрузка невозможна: ${cyclic.join(", ")}`);
    return { tables, order, deferred };
  }

  // One page of a table as JSON text. Tables with an `id` are read by key (stable inside the
  // snapshot, no OFFSET); the few without one are small and read whole.
  private async page(tx: Prisma.TransactionClient, table: string, redacted: string[], hasId: boolean, after: string | null): Promise<{ id: string; j: string }[]> {
    const json = redacted.length > 0 ? `(to_jsonb(t) - ARRAY[${redacted.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")}]::text[])::text` : `to_jsonb(t)::text`;
    if (!hasId) {
      const rows = await tx.$queryRawUnsafe<{ j: string }[]>(`SELECT ${json} AS j FROM ${quote(table)} t`);
      return rows.map((r) => ({ id: "", j: r.j }));
    }
    return tx.$queryRawUnsafe<{ id: string; j: string }[]>(
      `SELECT t."id" AS id, ${json} AS j FROM ${quote(table)} t ${after === null ? "" : `WHERE t."id" COLLATE "C" > $1 COLLATE "C"`} ORDER BY t."id" COLLATE "C" LIMIT ${PAGE}`,
      ...(after === null ? [] : [after]),
    );
  }
}
