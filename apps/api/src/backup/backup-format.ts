// The file format of «Скачать все данные», and the pure parts of reading it.
//
//   { "format": "aramir-export", "version": 1, "exportedAt": …, "migrations": [...],
//     "order": [table, …],               // parents before children
//     "tables": { "<table>": [ {row}, … ], … },
//     "complete": true }                 // written LAST: a cut-off download has no such marker
//
// Rows are exactly what the database holds (`to_jsonb(row)`), so a restore can hand
// them back to the same column types without guessing. Secrets are not in the file.

export const EXPORT_FORMAT = "aramir-export";
export const EXPORT_VERSION = 1;

// Never exported at all.
//  * _prisma_migrations: belongs to the schema, not to the data.
//  * telegram_link_tokens: one-time codes that expire in minutes.
export const EXCLUDED_TABLES: ReadonlySet<string> = new Set(["_prisma_migrations", "telegram_link_tokens"]);

// Columns left out of the rows. A restore asks for a temporary password instead.
export const REDACTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ["passwordHash"],
};

// A column whose name looks like a secret must be accounted for above; a spec scans the
// whole schema for these so a future one cannot slip into the file unnoticed.
export const SECRET_LOOKING = /password|secret|token|apikey|api_key|private.?key/i;

export interface ForeignKeyEdge {
  child: string;
  parent: string;
  // The referencing columns, and whether ALL of them may be NULL.
  columns: string[];
  nullable: boolean;
}

export interface DeferredReference {
  table: string;
  column: string;
}

// Parents before children (Kahn). A self reference is ignored here — the restore orders
// the rows of such a table itself.
//
// Real schemas loop: an organization points at the user who switched something on, and
// every user points back at the organization. A loop can only be loaded by loading one
// side with the reference EMPTY and filling it in afterwards, which is only possible
// where that column may be NULL. When the order gets stuck, such a reference is chosen
// (preferring one whose removal frees its table at once) and reported as `deferred`.
// A loop made only of required references cannot be loaded and is returned as `cyclic`.
export function orderTables(
  tables: string[],
  edges: ForeignKeyEdge[],
): { order: string[]; deferred: DeferredReference[]; cyclic: string[] } {
  const set = new Set(tables);
  let live = edges.filter((e) => e.child !== e.parent && set.has(e.child) && set.has(e.parent));
  const order: string[] = [];
  const deferred: DeferredReference[] = [];
  const done = new Set<string>();
  let remaining = [...tables].sort();
  const unmet = (t: string, from: ForeignKeyEdge[]) => new Set(from.filter((e) => e.child === t && !done.has(e.parent)).map((e) => e.parent));

  while (remaining.length > 0) {
    const ready = remaining.filter((t) => unmet(t, live).size === 0);
    if (ready.length > 0) {
      for (const t of ready) {
        order.push(t);
        done.add(t);
      }
      remaining = remaining.filter((t) => !done.has(t));
      continue;
    }
    // Stuck: defer one nullable reference between tables that are still waiting.
    const inLoop = new Set(remaining);
    const candidates = live
      .filter((e) => e.nullable && inLoop.has(e.child) && inLoop.has(e.parent))
      .sort((a, b) => {
        const free = (e: ReadonlyArray<ForeignKeyEdge>[number]) => (unmet(e.child, live).size === 1 ? 0 : 1);
        return free(a) - free(b) || a.child.localeCompare(b.child) || a.parent.localeCompare(b.parent);
      });
    if (candidates.length === 0) break;
    const pick = candidates[0];
    for (const column of pick.columns) deferred.push({ table: pick.child, column });
    live = live.filter((e) => e !== pick);
  }
  return { order, deferred, cyclic: remaining };
}

export interface ExportFile {
  format: string;
  version: number;
  exportedAt: string;
  migrations: string[];
  order: string[];
  // References left empty while loading and filled in at the end (see orderTables).
  deferred: DeferredReference[];
  tables: Record<string, Record<string, unknown>[]>;
  complete?: boolean;
}

// What a restore checks before it touches anything.
export function validateExport(file: unknown): asserts file is ExportFile {
  const f = file as Partial<ExportFile> | null;
  if (!f || f.format !== EXPORT_FORMAT) throw new Error("Это не файл выгрузки ArAmir OS");
  if (f.version !== EXPORT_VERSION) throw new Error(`Неизвестная версия файла: ${String(f.version)}`);
  if (f.complete !== true) throw new Error("Файл неполный (скачивание оборвалось) — восстановление невозможно");
  if (!Array.isArray(f.order) || !Array.isArray(f.deferred) || !f.tables || typeof f.tables !== "object") throw new Error("Файл повреждён");
  for (const t of f.order) {
    if (!Array.isArray(f.tables[t])) throw new Error(`В файле нет таблицы ${t}`);
  }
}

// Rows of a journal-lines style table cut into batches that never split one entry:
// the database checks an entry's lines as one set (see ledger_check_lines_balanced).
export function batchRows<T extends Record<string, unknown>>(rows: T[], size: number, groupKey?: string): T[][] {
  if (!groupKey) {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
  }
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(row[groupKey]);
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }
  const out: T[][] = [];
  let current: T[] = [];
  for (const g of groups.values()) {
    if (current.length > 0 && current.length + g.length > size) {
      out.push(current);
      current = [];
    }
    current.push(...g);
  }
  if (current.length > 0) out.push(current);
  return out;
}

// Rows of a table that references ITSELF, parents first (a category under a category,
// a reversal pointing at its original). Rows pointing at nothing, or at a row that is
// not in the file at all, go first.
export function orderSelfReferencing<T extends Record<string, unknown>>(rows: T[], idColumn: string, selfColumns: string[]): T[] {
  const ids = new Set(rows.map((r) => String(r[idColumn])));
  const placed = new Set<string>();
  const out: T[] = [];
  let pending = rows;
  while (pending.length > 0) {
    const next: T[] = [];
    for (const row of pending) {
      const blocked = selfColumns.some((c) => {
        const ref = row[c];
        return ref !== null && ref !== undefined && ids.has(String(ref)) && !placed.has(String(ref));
      });
      if (blocked) next.push(row);
      else {
        out.push(row);
        placed.add(String(row[idColumn]));
      }
    }
    if (next.length === pending.length) {
      // A genuine loop (should not exist): keep the rows rather than lose them.
      out.push(...next);
      break;
    }
    pending = next;
  }
  return out;
}
