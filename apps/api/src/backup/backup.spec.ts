import { Writable } from "stream";
import { Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { BackupService } from "./backup.service";
import {
  batchRows,
  EXCLUDED_TABLES,
  EXPORT_FORMAT,
  ForeignKeyEdge,
  orderSelfReferencing,
  orderTables,
  REDACTED_COLUMNS,
  SECRET_LOOKING,
  validateExport,
} from "./backup-format";

const edge = (child: string, parent: string, nullable = false): ForeignKeyEdge => ({ child, parent, columns: [`${parent}Id`], nullable });

describe("table order", () => {
  it("puts parents before children", () => {
    const { order, deferred, cyclic } = orderTables(["items", "sales", "organizations"], [edge("sales", "organizations"), edge("items", "sales")]);
    expect(order).toEqual(["organizations", "sales", "items"]);
    expect(deferred).toEqual([]);
    expect(cyclic).toEqual([]);
  });

  it("loads a loop by leaving one NULLable reference empty for the end", () => {
    // organization → the user who switched something on (optional); user → organization (required)
    const { order, deferred, cyclic } = orderTables(["organizations", "users", "sales"], [edge("users", "organizations"), edge("organizations", "users", true), edge("sales", "users")]);
    expect(order).toEqual(["organizations", "users", "sales"]);
    expect(deferred).toEqual([{ table: "organizations", column: "usersId" }]);
    expect(cyclic).toEqual([]);
  });

  it("never defers a reference that is required, and reports a loop made only of them", () => {
    const { cyclic, deferred } = orderTables(["a", "b"], [edge("a", "b"), edge("b", "a")]);
    expect(deferred).toEqual([]);
    expect(cyclic).toEqual(["a", "b"]);
  });

  it("ignores a table's reference to itself", () => {
    expect(orderTables(["categories"], [edge("categories", "categories", true)]).order).toEqual(["categories"]);
  });
});

describe("rows of one table", () => {
  it("puts a parent row before the rows that point at it", () => {
    const rows = [
      { id: "c", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "a", parentId: null },
      { id: "x", parentId: "not-in-file" },
    ];
    const ids = orderSelfReferencing(rows, "id", ["parentId"]).map((r) => r.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
    expect(ids).toHaveLength(4);
  });

  it("never splits one journal entry's lines across two batches", () => {
    const rows = [
      { id: 1, e: "A" },
      { id: 2, e: "B" },
      { id: 3, e: "A" },
      { id: 4, e: "C" },
      { id: 5, e: "B" },
    ];
    const batches = batchRows(rows, 3, "e");
    for (const entry of ["A", "B", "C"]) {
      expect(batches.filter((b) => b.some((r) => r.e === entry))).toHaveLength(1);
    }
    expect(batches.flat()).toHaveLength(5);
    expect(batchRows([1, 2, 3, 4, 5].map((id) => ({ id })), 2)).toHaveLength(3);
  });
});

describe("what a restore accepts", () => {
  const good = { format: EXPORT_FORMAT, version: 1, exportedAt: "x", migrations: [], order: ["a"], deferred: [], tables: { a: [] }, complete: true };
  it("accepts a whole file", () => expect(() => validateExport(good)).not.toThrow());
  it("refuses a download that was cut off", () => expect(() => validateExport({ ...good, complete: undefined })).toThrow("неполный"));
  it("refuses some other file", () => expect(() => validateExport({ foo: 1 })).toThrow("Это не файл выгрузки"));
  it("refuses a table that is missing", () => expect(() => validateExport({ ...good, order: ["a", "b"] })).toThrow("нет таблицы b"));
});

describe("the export of a real database", () => {
  const prisma = new PrismaService();
  const service = new BackupService(prisma);
  let org: IsolatedOrg;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "backup");
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  async function exportNow() {
    let text = "";
    const out = new Writable({
      write(chunk, _enc, cb) {
        text += chunk.toString();
        cb();
      },
    });
    const summary = await service.writeExport(org.user, out);
    return { file: JSON.parse(text) as { complete: boolean; order: string[]; tables: Record<string, Record<string, unknown>[]>; migrations: string[]; deferred: unknown[] }, summary };
  }

  it("is one complete file with every table, parents first, and our rows in it", async () => {
    const { file, summary } = await exportNow();
    expect(file.complete).toBe(true);
    expect(summary.tables).toBe(file.order.length);
    expect(file.migrations.length).toBeGreaterThan(50);
    expect(file.tables.organizations.some((o) => o.id === org.organizationId)).toBe(true);
    expect(file.tables.locations.filter((l) => l.organizationId === org.organizationId)).toHaveLength(2);
    expect(file.order.indexOf("locations")).toBeLessThan(file.order.indexOf("stock_levels"));
    expect(file.order.indexOf("sales")).toBeLessThan(file.order.indexOf("sale_items"));
    expect(file.order).not.toContain("_prisma_migrations");
    expect(file.order).not.toContain("telegram_link_tokens");
  });

  it("holds no password hash", async () => {
    const { file } = await exportNow();
    const mine = file.tables.users.find((u) => u.id === org.user.id)!;
    expect(mine.email).toBe(org.user.email);
    expect(Object.keys(mine)).not.toContain("passwordHash");
    expect(JSON.stringify(file)).not.toContain("not-a-real-hash");
  });

  it("is audited as a download, and reports when it last happened", async () => {
    await exportNow();
    const status = await service.status(org.organizationId);
    expect(status.lastExportBy).toBe(org.user.fullName);
    expect(Date.now() - new Date(status.lastExportAt!).getTime()).toBeLessThan(60_000);
  });

  it("leaves a secret-looking column out unless it was decided about", async () => {
    // A new column named like a secret must be listed in backup-format (redacted, or its
    // table excluded) — otherwise it would ride along into a file people keep on laptops.
    const cols = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT c.table_name, c.column_name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`;
    const undecided = cols
      .filter((c) => SECRET_LOOKING.test(c.column_name))
      .filter((c) => !EXCLUDED_TABLES.has(c.table_name) && !(REDACTED_COLUMNS[c.table_name] ?? []).includes(c.column_name))
      // A hash of CONTENT for tamper-evidence, not a credential.
      .filter((c) => !(c.table_name === "accounting_events" && c.column_name === "contentHash"));
    expect(undecided).toEqual([]);
  });

  it("is owner-only", () => {
    const roles = Reflect.getMetadata("roles", require("./backup.controller").BackupController) as Role[] | undefined;
    expect(roles).toEqual([Role.OWNER]);
  });
});
