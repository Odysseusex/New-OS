import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import {
  CUSTOMER_MANAGE_ROLES,
  PAYMENT_TERM_MAX_DAYS,
  PRODUCT_MANAGE_ROLES,
  PRODUCT_TYPE_LABELS_RU,
  ProductType,
  REFERENCE_COLUMNS,
  REFERENCE_IMPORT_MAX_ROWS,
  ReferenceCell,
  ReferenceExportDto,
  ReferenceImportAction,
  ReferenceImportChangeDto,
  ReferenceImportPreviewDto,
  ReferenceImportResultDto,
  ReferenceImportRowDto,
  ReferenceKind,
  ReferenceSheetRow,
  Role,
  SUPPLIER_MANAGE_ROLES,
  UNIT_LABELS_RU,
  Unit,
  categoryAcceptsType,
  normalizeBin,
  parseReferenceBoolean,
  parseReferenceNumber,
  readReferenceSheet,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { CATEGORY_WITH_PARENT, categoryLabel } from "../common/category-label";
import { recordAudit } from "../audit/audit";
import { ProductsService } from "../products/products.service";
import { CustomersService } from "../customers/customers.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { CreateProductDto } from "../products/dto/create-product.dto";
import { UpdateProductDto } from "../products/dto/update-product.dto";

// Who may load a directory = who may create its entries by hand.
const ROLES_BY_KIND: Record<ReferenceKind, Role[]> = {
  products: PRODUCT_MANAGE_ROLES,
  customers: CUSTOMER_MANAGE_ROLES,
  suppliers: SUPPLIER_MANAGE_ROLES,
};

const HEADER_BY_KEY: Record<ReferenceKind, Record<string, string>> = Object.fromEntries(
  (Object.keys(REFERENCE_COLUMNS) as ReferenceKind[]).map((kind) => [kind, Object.fromEntries(REFERENCE_COLUMNS[kind].map((c) => [c.key, c.header]))]),
) as Record<ReferenceKind, Record<string, string>>;

const TYPE_BY_TEXT = new Map<string, ProductType>();
for (const t of Object.values(ProductType)) {
  TYPE_BY_TEXT.set(t.toLowerCase(), t);
  TYPE_BY_TEXT.set(PRODUCT_TYPE_LABELS_RU[t].toLowerCase().replace(/ё/g, "е"), t);
}
TYPE_BY_TEXT.set("сырье", ProductType.RAW_MATERIAL);
TYPE_BY_TEXT.set("готовое", ProductType.FINISHED_GOOD);
TYPE_BY_TEXT.set("готовая", ProductType.FINISHED_GOOD);

const UNIT_BY_TEXT = new Map<string, Unit>();
for (const u of Object.values(Unit)) {
  UNIT_BY_TEXT.set(u.toLowerCase(), u);
  UNIT_BY_TEXT.set(UNIT_LABELS_RU[u], u);
}
for (const [alias, u] of [["шт.", Unit.PCS], ["кг.", Unit.KG], ["г.", Unit.G], ["гр", Unit.G], ["л.", Unit.L], ["мл.", Unit.ML]] as const) UNIT_BY_TEXT.set(alias, u);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const lower = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/ё/g, "е");
const shown = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const yesNo = (v: boolean) => (v ? "да" : "нет");

interface Planned {
  row: ReferenceImportRowDto;
  create?: Record<string, unknown>;
  update?: { id: string; dto: Record<string, unknown> };
}

// Collects a row's field values and what each changes, refusing the first bad cell.
class RowBuilder {
  readonly changes: ReferenceImportChangeDto[] = [];
  readonly dto: Record<string, unknown> = {};
  error: string | null = null;

  constructor(private headers: Record<string, string>) {}

  fail(message: string): void {
    if (!this.error) this.error = message;
  }

  // `before === undefined` = a new entry (every value is a change).
  set(key: string, field: string, value: unknown, before: unknown, show: (v: unknown) => string | null = shown): void {
    const same = before !== undefined && shown(before) === shown(value);
    if (same) return;
    this.dto[field] = value;
    this.changes.push({ field: this.headers[key], before: before === undefined ? null : show(before), after: show(value) });
  }
}

@Injectable()
export class ReferenceDataService {
  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
    private customers: CustomersService,
    private suppliers: SuppliersService,
  ) {}

  private assertRole(user: AuthenticatedUser, kind: ReferenceKind): void {
    if (!ROLES_BY_KIND[kind]) throw new BadRequestException("Неизвестный справочник");
    if (!ROLES_BY_KIND[kind].includes(user.role)) throw new ForbiddenException("Недостаточно прав для этого справочника");
  }

  async export(user: AuthenticatedUser, kind: ReferenceKind): Promise<ReferenceExportDto> {
    this.assertRole(user, kind);
    const headers = REFERENCE_COLUMNS[kind].map((c) => c.header);
    const organizationId = user.organizationId;
    let rows: ReferenceCell[][];
    if (kind === "products") {
      const list = await this.prisma.product.findMany({
        where: { organizationId, isActive: true },
        include: { categoryRef: CATEGORY_WITH_PARENT },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      });
      rows = list.map((p) => [
        p.sku,
        p.name,
        PRODUCT_TYPE_LABELS_RU[p.type as ProductType],
        categoryLabel(p.categoryRef),
        UNIT_LABELS_RU[p.unit as Unit],
        p.price.toNumber(),
        p.barcode,
        p.ntin,
        p.minQuantity.toNumber(),
        yesNo(p.trackInventory),
      ]);
    } else if (kind === "customers") {
      const list = await this.prisma.customer.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" } });
      rows = list.map((c) => [c.name, c.bin, c.phone, c.email, c.address, c.paymentTermDays, c.creditLimit?.toNumber() ?? null, c.notes]);
    } else {
      const list = await this.prisma.supplier.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" } });
      rows = list.map((s) => [s.name, s.bin, s.phone, s.email, s.paymentTermDays, s.notes]);
    }
    return { kind, headers, rows };
  }

  async preview(user: AuthenticatedUser, kind: ReferenceKind, grid: unknown): Promise<ReferenceImportPreviewDto> {
    this.assertRole(user, kind);
    const { sheet, planned } = await this.plan(user.organizationId, kind, grid);
    const counts: Record<ReferenceImportAction, number> = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 0 };
    for (const p of planned) counts[p.row.action] += 1;
    return { kind, columns: sheet.columns, ignoredHeaders: sheet.ignoredHeaders, rows: planned.map((p) => p.row), counts };
  }

  // Planned again from the database as it is now, then row by row through the
  // module's own create/update — so every rule of the hand-made form applies.
  async apply(user: AuthenticatedUser, kind: ReferenceKind, grid: unknown): Promise<ReferenceImportResultDto> {
    this.assertRole(user, kind);
    const { planned } = await this.plan(user.organizationId, kind, grid);
    const result: ReferenceImportResultDto = { kind, created: 0, updated: 0, unchanged: 0, failed: [] };
    for (const p of planned) {
      if (p.row.action === "ERROR") {
        result.failed.push(p.row);
        continue;
      }
      if (p.row.action === "UNCHANGED") {
        result.unchanged += 1;
        continue;
      }
      try {
        await this.write(user, kind, p);
        if (p.create) result.created += 1;
        else result.updated += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Не удалось записать строку";
        result.failed.push({ ...p.row, action: "ERROR", error: message });
      }
    }
    await this.prisma.$transaction((tx) =>
      recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "referenceImport.apply",
        entityType: "ReferenceImport",
        entityId: kind,
        after: { kind, created: result.created, updated: result.updated, unchanged: result.unchanged, failed: result.failed.length },
      }),
    );
    return result;
  }

  private async write(user: AuthenticatedUser, kind: ReferenceKind, p: Planned): Promise<void> {
    const org = user.organizationId;
    if (kind === "products") {
      if (p.create) await this.products.create(org, p.create as unknown as CreateProductDto);
      else if (p.update) await this.products.update(org, p.update.id, p.update.dto as UpdateProductDto, user.id);
    } else if (kind === "customers") {
      if (p.create) await this.customers.create(org, p.create as never);
      else if (p.update) await this.customers.update(org, p.update.id, p.update.dto as never, user.id);
    } else {
      if (p.create) await this.suppliers.create(org, p.create as never);
      else if (p.update) await this.suppliers.update(org, p.update.id, p.update.dto as never, user.id);
    }
  }

  private async plan(organizationId: string, kind: ReferenceKind, grid: unknown) {
    const sheet = readReferenceSheet(kind, sanitizeGrid(grid));
    if ("error" in sheet) throw new BadRequestException(sheet.error);
    if (sheet.rows.length === 0) throw new BadRequestException("В файле нет строк под заголовком");
    if (sheet.rows.length > REFERENCE_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`В файле больше ${REFERENCE_IMPORT_MAX_ROWS} строк — разбейте его на части`);
    }
    const planned =
      kind === "products" ? await this.planProducts(organizationId, sheet.rows) : await this.planCounterparties(organizationId, kind, sheet.rows);
    return { sheet, planned };
  }

  private async planProducts(organizationId: string, rows: ReferenceSheetRow[]): Promise<Planned[]> {
    const headers = HEADER_BY_KEY.products;
    const [products, categories] = await Promise.all([
      this.prisma.product.findMany({ where: { organizationId }, include: { categoryRef: CATEGORY_WITH_PARENT } }),
      this.prisma.category.findMany({ where: { organizationId }, include: { parent: true } }),
    ]);
    const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
    const byName = new Map<string, typeof products>();
    for (const p of products) byName.set(lower(p.name), [...(byName.get(lower(p.name)) ?? []), p]);
    const categoryByLabel = new Map<string, (typeof categories)[number][]>();
    for (const c of categories) {
      const keys = [lower(categoryLabel(c) ?? c.name), lower(c.name)];
      for (const k of new Set(keys)) categoryByLabel.set(k, [...(categoryByLabel.get(k) ?? []), c]);
    }
    const seenSku = new Set<string>();
    const seenName = new Set<string>();

    return rows.map(({ row, values }) => {
      const b = new RowBuilder(headers);
      const name = (values.name ?? "").replace(/\s+/g, " ").trim();
      const sku = (values.sku ?? "").trim();
      const result = (action: ReferenceImportAction, extra: Partial<Planned> = {}): Planned => ({
        row: { row, action: b.error ? "ERROR" : action, name, key: sku || null, changes: b.error ? [] : b.changes, error: b.error, warning: null },
        ...(b.error ? {} : extra),
      });

      // Who this row is.
      let existing: (typeof products)[number] | undefined;
      if (sku.length === 1) b.fail("Артикул короче 2 символов");
      if (sku) {
        if (seenSku.has(sku.toLowerCase())) b.fail("Артикул повторяется в файле");
        seenSku.add(sku.toLowerCase());
        existing = bySku.get(sku.toLowerCase());
        if (!existing && name) {
          const other = (byName.get(lower(name)) ?? []).filter((p) => p.isActive);
          if (other.length > 0) b.fail(`Товар «${other[0].name}» уже есть с артикулом ${other[0].sku} — исправьте артикул или очистите его`);
        }
      } else if (name) {
        if (seenName.has(lower(name))) b.fail("Наименование без артикула повторяется в файле — укажите артикулы");
        seenName.add(lower(name));
        const same = byName.get(lower(name)) ?? [];
        if (same.length > 1) b.fail("Несколько товаров с таким наименованием — укажите артикул");
        existing = same[0];
      }
      if (!existing && !name) b.fail("Не заполнено наименование");
      if (name && name.length < 2) b.fail("Наименование короче 2 символов");

      // Values: a blank cell leaves the field as it is.
      let type: ProductType | undefined;
      if (values.type) {
        type = TYPE_BY_TEXT.get(lower(values.type));
        if (!type) b.fail(`Непонятный тип «${values.type}» — ${Object.values(PRODUCT_TYPE_LABELS_RU).join(", ")}`);
      }
      let unit: Unit | undefined;
      if (values.unit) {
        unit = UNIT_BY_TEXT.get(lower(values.unit));
        if (!unit) b.fail(`Непонятная единица «${values.unit}» — шт, кг, г, л, мл`);
      }
      const finalType = type ?? (existing?.type as ProductType | undefined);
      if (!existing) {
        if (!type) b.fail("Для нового товара укажите тип");
        if (!unit) b.fail("Для нового товара укажите единицу");
      }
      const price = numberCell(b, values.price, headers.price);
      const minQuantity = numberCell(b, values.minQuantity, headers.minQuantity);
      let trackInventory: boolean | undefined;
      if (values.trackInventory) {
        const v = parseReferenceBoolean(values.trackInventory);
        if (v === null) b.fail(`«${headers.trackInventory}»: да или нет`);
        else trackInventory = v;
      }
      let categoryId: string | undefined;
      if (values.category) {
        const found = categoryByLabel.get(lower(values.category.replace(/\s*[›>/]\s*/g, " › "))) ?? [];
        if (found.length === 0) b.fail(`Нет категории «${values.category}»`);
        else if (found.length > 1) b.fail(`Категорий «${values.category}» несколько — укажите «Категория › Подкатегория»`);
        else {
          if (finalType && !categoryAcceptsType(found[0].type as ProductType | null, finalType)) {
            b.fail(`Категория «${categoryLabel(found[0])}» не для типа «${PRODUCT_TYPE_LABELS_RU[finalType]}»`);
          }
          categoryId = found[0].id;
        }
      }
      if (b.error) return result("ERROR");

      const typeLabel = (v: unknown) => (v ? PRODUCT_TYPE_LABELS_RU[v as ProductType] : null);
      const unitLabel = (v: unknown) => (v ? UNIT_LABELS_RU[v as Unit] : null);
      const categoryShown = (v: unknown) => {
        const c = categories.find((x) => x.id === v);
        return c ? categoryLabel(c) : null;
      };
      const boolShown = (v: unknown) => (v === undefined || v === null ? null : yesNo(Boolean(v)));

      if (!existing) {
        if (sku) b.set("sku", "sku", sku, undefined);
        b.set("name", "name", name, undefined);
        b.set("type", "type", type, undefined, typeLabel);
        b.set("unit", "unit", unit, undefined, unitLabel);
        b.set("price", "price", price ?? 0, undefined);
        if (categoryId) b.set("category", "categoryId", categoryId, undefined, categoryShown);
        if (values.barcode) b.set("barcode", "barcode", values.barcode, undefined);
        if (values.ntin) b.set("ntin", "ntin", values.ntin, undefined);
        if (minQuantity !== undefined) b.set("minQuantity", "minQuantity", minQuantity, undefined);
        if (trackInventory !== undefined) b.set("trackInventory", "trackInventory", trackInventory, undefined, boolShown);
        return result("CREATE", { create: b.dto });
      }

      if (name && name !== existing.name) b.set("name", "name", name, existing.name);
      if (type) b.set("type", "type", type, existing.type, typeLabel);
      if (unit) b.set("unit", "unit", unit, existing.unit, unitLabel);
      if (price !== undefined) b.set("price", "price", price, existing.price.toNumber());
      if (categoryId) b.set("category", "categoryId", categoryId, existing.categoryId, categoryShown);
      if (values.barcode) b.set("barcode", "barcode", values.barcode, existing.barcode);
      if (values.ntin) b.set("ntin", "ntin", values.ntin, existing.ntin);
      if (minQuantity !== undefined) b.set("minQuantity", "minQuantity", minQuantity, existing.minQuantity.toNumber());
      if (trackInventory !== undefined) b.set("trackInventory", "trackInventory", trackInventory, existing.trackInventory, boolShown);
      const planned = result(b.changes.length > 0 ? "UPDATE" : "UNCHANGED", { update: { id: existing.id, dto: b.dto } });
      planned.row.key = existing.sku;
      if (!name) planned.row.name = existing.name;
      if (!existing.isActive && planned.row.action === "UPDATE") planned.row.warning = "товар в архиве — данные обновятся, из архива не вернётся";
      return planned;
    });
  }

  private async planCounterparties(organizationId: string, kind: "customers" | "suppliers", rows: ReferenceSheetRow[]): Promise<Planned[]> {
    const headers = HEADER_BY_KEY[kind];
    type Party = { id: string; name: string; bin: string | null; phone: string | null; email: string | null; address?: string | null; notes: string | null; paymentTermDays: number | null; creditLimit?: { toNumber(): number } | null; isActive: boolean };
    const list: Party[] =
      kind === "customers"
        ? await this.prisma.customer.findMany({ where: { organizationId } })
        : await this.prisma.supplier.findMany({ where: { organizationId } });
    const byBin = new Map(list.filter((p) => p.bin).map((p) => [p.bin as string, p]));
    const byName = new Map<string, Party[]>();
    for (const p of list) byName.set(lower(p.name), [...(byName.get(lower(p.name)) ?? []), p]);
    const seen = new Set<string>();
    const word = kind === "customers" ? "клиент" : "поставщик";

    return rows.map(({ row, values }) => {
      const b = new RowBuilder(headers);
      const name = (values.name ?? "").replace(/\s+/g, " ").trim();
      let bin: string | null = null;
      if (values.bin) {
        bin = normalizeBin(values.bin);
        if (!bin) b.fail("БИН/ИИН — 12 цифр");
      }
      const result = (action: ReferenceImportAction, extra: Partial<Planned> = {}): Planned => ({
        row: { row, action: b.error ? "ERROR" : action, name, key: bin, changes: b.error ? [] : b.changes, error: b.error, warning: null },
        ...(b.error ? {} : extra),
      });

      const identity = bin ? `bin:${bin}` : `name:${lower(name)}`;
      if (seen.has(identity)) b.fail(bin ? "БИН/ИИН повторяется в файле" : "Наименование повторяется в файле");
      seen.add(identity);

      let existing: Party | undefined;
      if (bin) existing = byBin.get(bin);
      if (!existing && name) {
        const same = byName.get(lower(name)) ?? [];
        if (same.length > 1) b.fail(`Несколько записей «${name}» — укажите БИН/ИИН`);
        else if (same[0] && bin && same[0].bin && same[0].bin !== bin) {
          b.fail(`«${same[0].name}» уже есть с БИН/ИИН ${same[0].bin}`);
        } else existing = same[0];
      }
      if (!existing && !name) b.fail("Не заполнено наименование");
      if (name && name.length < 2) b.fail("Наименование короче 2 символов");
      if (values.email && !EMAIL.test(values.email)) b.fail(`Неверный email «${values.email}»`);
      let term: number | undefined;
      if (values.paymentTermDays) {
        const n = parseReferenceNumber(values.paymentTermDays);
        if (n === null || !Number.isInteger(n) || n < 0 || n > PAYMENT_TERM_MAX_DAYS) b.fail(`Отсрочка — целое число дней от 0 до ${PAYMENT_TERM_MAX_DAYS}`);
        else term = n;
      }
      const creditLimit = kind === "customers" ? numberCell(b, values.creditLimit, headers.creditLimit) : undefined;
      if (b.error) return result("ERROR");

      const fields: [string, unknown][] = [
        ["phone", values.phone || undefined],
        ["email", values.email || undefined],
        ...(kind === "customers" ? ([["address", values.address || undefined]] as [string, unknown][]) : []),
        ["notes", values.notes || undefined],
      ];
      if (!existing) {
        b.set("name", "name", name, undefined);
        if (bin) b.set("bin", "bin", bin, undefined);
        for (const [k, v] of fields) if (v !== undefined) b.set(k, k, v, undefined);
        if (term !== undefined) b.set("paymentTermDays", "paymentTermDays", term, undefined);
        if (creditLimit !== undefined) b.set("creditLimit", "creditLimit", creditLimit, undefined);
        return result("CREATE", { create: b.dto });
      }
      if (name && name !== existing.name) b.set("name", "name", name, existing.name);
      if (bin) b.set("bin", "bin", bin, existing.bin);
      for (const [k, v] of fields) if (v !== undefined) b.set(k, k, v, (existing as unknown as Record<string, unknown>)[k] ?? null);
      if (term !== undefined) b.set("paymentTermDays", "paymentTermDays", term, existing.paymentTermDays);
      if (creditLimit !== undefined) b.set("creditLimit", "creditLimit", creditLimit, existing.creditLimit?.toNumber() ?? null);
      const planned = result(b.changes.length > 0 ? "UPDATE" : "UNCHANGED", { update: { id: existing.id, dto: b.dto } });
      planned.row.key = bin ?? existing.bin;
      if (!name) planned.row.name = existing.name;
      if (!existing.isActive && planned.row.action === "UPDATE") planned.row.warning = `${word} в архиве — данные обновятся, из архива не вернётся`;
      return planned;
    });
  }
}

function numberCell(b: RowBuilder, text: string | undefined, header: string): number | undefined {
  if (!text) return undefined;
  const n = parseReferenceNumber(text);
  if (n === null || n < 0) {
    b.fail(`«${header}»: нужно число не меньше нуля`);
    return undefined;
  }
  return n;
}

// The body is the browser's reading of a sheet: anything that is not a short
// string or a finite number becomes an empty cell.
function sanitizeGrid(grid: unknown): ReferenceCell[][] {
  if (!Array.isArray(grid)) throw new BadRequestException("Нет данных файла");
  if (grid.length > REFERENCE_IMPORT_MAX_ROWS + 50) throw new BadRequestException(`В файле больше ${REFERENCE_IMPORT_MAX_ROWS} строк — разбейте его на части`);
  return grid.map((row) =>
    Array.isArray(row)
      ? row.slice(0, 60).map((cell) => (typeof cell === "number" && Number.isFinite(cell) ? cell : typeof cell === "string" ? cell.slice(0, 500) : null))
      : [],
  );
}
