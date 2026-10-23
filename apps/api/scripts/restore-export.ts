/* eslint-disable no-console */
// Restores a «Скачать все данные» file into an EMPTY database.
//
//   1. Create an empty database and apply the schema:   npx prisma migrate deploy
//   2. Point DATABASE_URL at it and run:
//        npx ts-node scripts/restore-export.ts <file.json> --yes [--temp-password <text>]
//
// It refuses a database that already holds any rows, checks every table's row count after
// loading, and gives every user the same TEMPORARY password (the file holds no password
// hashes) — printed once at the end; people change it after the first login.
// Nothing in the source database is touched: this only reads the file.

import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { batchRows, orderSelfReferencing, validateExport } from "../src/backup/backup-format";

const BATCH = 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("Использование: npx ts-node scripts/restore-export.ts <файл.json> --yes [--temp-password <пароль>]");
    process.exit(2);
  }
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  validateExport(data);

  const url = process.env.DATABASE_URL ?? "";
  const target = url.replace(/\/\/[^@]*@/, "//***@");
  console.log(`Файл: ${file} (выгружен ${data.exportedAt})`);
  console.log(`База назначения: ${target || "(DATABASE_URL не задан)"}`);
  if (!process.argv.includes("--yes")) {
    console.error("Это загрузит данные в базу назначения. Проверьте адрес выше и запустите снова с --yes.");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    // 1. The schema must be there, and at least as new as the file.
    const applied = (await prisma.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)).map((m) => m.migration_name);
    const missing = data.migrations.filter((m) => !applied.includes(m));
    if (missing.length > 0) throw new Error(`В базе назначения нет миграций из файла (выполните prisma migrate deploy): ${missing.join(", ")}`);

    // 2. It must be empty.
    const existing = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations'`,
    );
    const filled: string[] = [];
    for (const { table_name } of existing) {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM ${quote(table_name)}`);
      if (n > 0n) filled.push(`${table_name} (${n})`);
    }
    if (filled.length > 0) throw new Error(`База назначения не пуста — восстановление отменено: ${filled.slice(0, 8).join(", ")}`);

    // 3. Which tables point at themselves, and which columns auto-number.
    const selfRefs = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(`
      SELECT c.relname AS table_name, a.attname AS column_name
        FROM pg_constraint k
        JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
       WHERE k.contype = 'f' AND k.conrelid = k.confrelid AND k.connamespace = 'public'::regnamespace`);
    const selfByTable = new Map<string, string[]>();
    for (const r of selfRefs) selfByTable.set(r.table_name, [...(selfByTable.get(r.table_name) ?? []), r.column_name]);

    const tempPassword = arg("--temp-password") ?? randomBytes(6).toString("base64url");
    const tempHash = await bcrypt.hash(tempPassword, 10);

    // 4. Load, in one transaction: all of it or none of it.
    const loaded: Record<string, number> = {};
    const deferredByTable = new Map<string, string[]>();
    for (const d of data.deferred) deferredByTable.set(d.table, [...(deferredByTable.get(d.table) ?? []), d.column]);
    await prisma.$transaction(
      async (tx) => {
        for (const table of data.order) {
          let rows = data.tables[table];
          if (rows.length === 0) continue;
          if (table === "users") rows = rows.map((r) => ({ ...r, passwordHash: tempHash }));
          const self = selfByTable.get(table);
          if (self) rows = orderSelfReferencing(rows, "id", self);
          // References that close a loop are loaded empty and filled in below.
          const later = deferredByTable.get(table);
          if (later) rows = rows.map((r) => ({ ...r, ...Object.fromEntries(later.map((c) => [c, null])) }));
          // A journal entry's lines are checked by the database as one set, so they must
          // arrive whole.
          const batches = batchRows(rows, BATCH, table === "journal_lines" ? "journalEntryId" : undefined);
          for (const batch of batches) {
            await tx.$executeRawUnsafe(`INSERT INTO ${quote(table)} SELECT * FROM jsonb_populate_recordset(NULL::${quote(table)}, $1::jsonb)`, JSON.stringify(batch));
          }
          loaded[table] = rows.length;
          console.log(`  ${table}: ${rows.length}`);
        }
        for (const [table, columns] of deferredByTable) {
          const withValues = data.tables[table].filter((r) => columns.some((c) => r[c] !== null && r[c] !== undefined));
          for (const batch of batchRows(withValues, BATCH)) {
            const patch = batch.map((r) => ({ id: r.id, ...Object.fromEntries(columns.map((c) => [c, r[c]])) }));
            await tx.$executeRawUnsafe(
              `UPDATE ${quote(table)} t SET ${columns.map((c) => `${quote(c)} = v.${quote(c)}`).join(", ")} FROM jsonb_populate_recordset(NULL::${quote(table)}, $1::jsonb) v WHERE t."id" = v."id"`,
              JSON.stringify(patch),
            );
          }
        }
        // 5. Counts must match what the file says, table by table.
        for (const table of data.order) {
          const expected = data.tables[table].length;
          const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM ${quote(table)}`);
          if (Number(n) !== expected) throw new Error(`Не сошлось число строк в ${table}: в файле ${expected}, загружено ${n}`);
        }
      },
      { maxWait: 30_000, timeout: 30 * 60_000 },
    );

    // 6. Auto-numbered columns continue after the highest restored value.
    const serials = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; seq: string | null }[]>(`
      SELECT table_name, column_name, pg_get_serial_sequence(quote_ident(table_name), column_name) AS seq
        FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'`);
    for (const s of serials) {
      if (!s.seq) continue;
      await prisma.$executeRawUnsafe(`SELECT setval('${s.seq}', COALESCE((SELECT MAX(${quote(s.column_name)}) FROM ${quote(s.table_name)}), 1), (SELECT MAX(${quote(s.column_name)}) FROM ${quote(s.table_name)}) IS NOT NULL)`);
    }

    const total = Object.values(loaded).reduce((a, b) => a + b, 0);
    console.log(`\nГотово: ${Object.keys(loaded).length} таблиц, ${total} строк, всё сошлось.`);
    console.log(`Временный пароль для ВСЕХ пользователей: ${tempPassword}`);
    console.log("Войдите и сразу смените пароли (Настройки → сотрудники).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`\nОШИБКА: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
