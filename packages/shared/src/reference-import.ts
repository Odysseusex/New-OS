// Reference data (номенклатура, клиенты, поставщики) loaded from an Excel
// template and written back out in the same shape. The browser reads the
// sheet into a grid of cells; everything else — finding the header row,
// matching headers to fields — is this pure code, shared by both sides.

export type ReferenceKind = "products" | "customers" | "suppliers";
export const REFERENCE_KINDS: ReferenceKind[] = ["products", "customers", "suppliers"];

export const REFERENCE_KIND_LABELS_RU: Record<ReferenceKind, string> = {
  products: "Номенклатура",
  customers: "Клиенты",
  suppliers: "Поставщики",
};

export interface ReferenceColumn {
  key: string;
  header: string;
  aliases?: string[];
}

const NAME: ReferenceColumn = { key: "name", header: "Наименование", aliases: ["Название", "Наименование товара", "Товар", "Клиент", "Поставщик"] };
const BIN: ReferenceColumn = { key: "bin", header: "БИН/ИИН", aliases: ["БИН", "ИИН", "ИИН/БИН"] };
const PHONE: ReferenceColumn = { key: "phone", header: "Телефон" };
const EMAIL: ReferenceColumn = { key: "email", header: "Email", aliases: ["E-mail", "Почта", "Эл. почта"] };
const TERM: ReferenceColumn = { key: "paymentTermDays", header: "Отсрочка, дней", aliases: ["Отсрочка", "Отсрочка платежа"] };
const NOTES: ReferenceColumn = { key: "notes", header: "Примечание", aliases: ["Комментарий"] };

export const REFERENCE_COLUMNS: Record<ReferenceKind, ReferenceColumn[]> = {
  products: [
    { key: "sku", header: "Артикул", aliases: ["SKU", "Код"] },
    NAME,
    { key: "type", header: "Тип", aliases: ["Тип товара"] },
    { key: "category", header: "Категория", aliases: ["Категория › Подкатегория"] },
    { key: "unit", header: "Ед. изм.", aliases: ["Ед.", "Единица", "Единица измерения"] },
    { key: "price", header: "Цена, ₸", aliases: ["Цена"] },
    { key: "barcode", header: "Штрихкод", aliases: ["Штрих-код"] },
    { key: "ntin", header: "Код NTIN", aliases: ["NTIN"] },
    { key: "minQuantity", header: "Мин. остаток", aliases: ["Минимальный остаток"] },
    { key: "trackInventory", header: "Учёт остатка", aliases: ["Учитывать остаток"] },
  ],
  customers: [
    NAME,
    BIN,
    PHONE,
    EMAIL,
    { key: "address", header: "Адрес" },
    TERM,
    { key: "creditLimit", header: "Кредитный лимит, ₸", aliases: ["Кредитный лимит"] },
    NOTES,
  ],
  suppliers: [NAME, BIN, PHONE, EMAIL, TERM, NOTES],
};

export const REFERENCE_IMPORT_MAX_ROWS = 2000;

export type ReferenceCell = string | number | null;

export interface ReferenceSheetRow {
  // The row number as Excel shows it (1-based), so a message can point at it.
  row: number;
  // Only columns present in the file; a blank cell is "".
  values: Record<string, string>;
}

export interface ReferenceSheet {
  columns: string[];
  ignoredHeaders: string[];
  rows: ReferenceSheetRow[];
}

function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[*:]/g, "")
    .replace(/,?\s*₸/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(cell: ReferenceCell | undefined, key: string | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    // A БИН/ИИН typed as a number loses its leading zero (ИИН of someone born
    // 2000–2009 starts with one) — only that one; a shorter number stays wrong.
    if (key === "bin" && Number.isInteger(cell) && String(cell).length === 11) return `0${cell}`;
    // A phone typed as a number loses its «+»: 77011234567 → +77011234567.
    if (key === "phone" && Number.isInteger(cell) && /^7\d{10}$/.test(String(cell))) return `+${cell}`;
    return String(cell);
  }
  return cell.replace(/ /g, " ").trim();
}

// The header row is the first of the first 15 rows that has the «Наименование»
// column; rows above it (a title) are skipped. A row with nothing in any known
// column is left out.
export function readReferenceSheet(kind: ReferenceKind, grid: ReferenceCell[][]): ReferenceSheet | { error: string } {
  const columns = REFERENCE_COLUMNS[kind];
  const byLabel = new Map<string, string>();
  for (const c of columns) for (const label of [c.header, ...(c.aliases ?? [])]) byLabel.set(normalizeHeader(label), c.key);

  for (let h = 0; h < Math.min(grid.length, 15); h += 1) {
    const header = grid[h] ?? [];
    const keyAt = header.map((cell) => byLabel.get(normalizeHeader(cellText(cell, undefined))));
    if (!keyAt.includes("name")) continue;

    const seen = new Set<string>();
    const ignoredHeaders: string[] = [];
    header.forEach((cell, i) => {
      const key = keyAt[i];
      const text = cellText(cell, undefined);
      if (!key) {
        if (text) ignoredHeaders.push(text);
      } else if (seen.has(key)) {
        keyAt[i] = undefined;
        ignoredHeaders.push(text);
      } else {
        seen.add(key);
      }
    });

    const rows: ReferenceSheetRow[] = [];
    for (let r = h + 1; r < grid.length; r += 1) {
      const values: Record<string, string> = {};
      let any = false;
      keyAt.forEach((key, i) => {
        if (!key) return;
        const text = cellText(grid[r]?.[i], key);
        values[key] = text;
        if (text) any = true;
      });
      if (any) rows.push({ row: r + 1, values });
    }
    return { columns: columns.filter((c) => seen.has(c.key)).map((c) => c.key), ignoredHeaders, rows };
  }
  return { error: "В файле не найдена строка заголовков с колонкой «Наименование» — скачайте шаблон" };
}

// «1 234,50» → 1234.5; anything else that is not a plain number → null.
export function parseReferenceNumber(text: string): number | null {
  const cleaned = text.replace(/[\s ₸]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseReferenceBoolean(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (["да", "1", "true", "yes", "+"].includes(t)) return true;
  if (["нет", "0", "false", "no", "-"].includes(t)) return false;
  return null;
}

export type ReferenceImportAction = "CREATE" | "UPDATE" | "UNCHANGED" | "ERROR";

export interface ReferenceImportChangeDto {
  field: string;
  before: string | null;
  after: string | null;
}

export interface ReferenceImportRowDto {
  row: number;
  action: ReferenceImportAction;
  name: string;
  // Артикул for a product, БИН/ИИН for a counterparty.
  key: string | null;
  changes: ReferenceImportChangeDto[];
  error: string | null;
  // Goes in, but worth a look (an archived entry being updated).
  warning: string | null;
}

export interface ReferenceImportPreviewDto {
  kind: ReferenceKind;
  columns: string[];
  ignoredHeaders: string[];
  rows: ReferenceImportRowDto[];
  counts: Record<ReferenceImportAction, number>;
}

// Rows are applied one by one: a row refused at apply time is reported and
// the others still go in. Loading the same file again changes nothing more.
export interface ReferenceImportResultDto {
  kind: ReferenceKind;
  created: number;
  updated: number;
  unchanged: number;
  failed: ReferenceImportRowDto[];
}

export interface ReferenceImportRequestDto {
  grid: ReferenceCell[][];
}

export interface ReferenceExportDto {
  kind: ReferenceKind;
  headers: string[];
  rows: ReferenceCell[][];
}
