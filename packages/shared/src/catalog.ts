export enum Unit {
  PCS = "PCS",
  KG = "KG",
  G = "G",
  L = "L",
  ML = "ML",
}

export const UNIT_LABELS_RU: Record<Unit, string> = {
  [Unit.PCS]: "шт",
  [Unit.KG]: "кг",
  [Unit.G]: "г",
  [Unit.L]: "л",
  [Unit.ML]: "мл",
};

// Every unit belongs to exactly one measurement family. Only units in the
// same family can be converted into each other — this is what a quantity
// input's unit toggle is allowed to offer, and what convertUnitQuantity
// will accept.
type UnitFamily = "MASS" | "VOLUME" | "COUNT";

const UNIT_FAMILY: Record<Unit, UnitFamily> = {
  [Unit.KG]: "MASS",
  [Unit.G]: "MASS",
  [Unit.L]: "VOLUME",
  [Unit.ML]: "VOLUME",
  [Unit.PCS]: "COUNT",
};

// How many of this unit make up one "reference" unit of its family (gram
// for mass, millilitre for volume). Used only to convert within a family.
const UNIT_TO_FAMILY_REFERENCE: Record<Unit, number> = {
  [Unit.KG]: 1000,
  [Unit.G]: 1,
  [Unit.L]: 1000,
  [Unit.ML]: 1,
  [Unit.PCS]: 1,
};

// The other unit in the same family, for a quantity input's unit toggle.
// PCS has no alternate — there's nothing smaller/larger to enter it in.
export const UNIT_ALTERNATE: Partial<Record<Unit, Unit>> = {
  [Unit.KG]: Unit.G,
  [Unit.G]: Unit.KG,
  [Unit.L]: Unit.ML,
  [Unit.ML]: Unit.L,
};

// Units the user may pick when typing a quantity meant for `baseUnit` —
// always includes baseUnit itself, plus its family alternate if any.
export function getCompatibleUnits(baseUnit: Unit): Unit[] {
  const alternate = UNIT_ALTERNATE[baseUnit];
  return alternate ? [baseUnit, alternate] : [baseUnit];
}

// Converts a quantity between two units of the same family (e.g. g <-> kg).
// Throws for cross-family conversion (e.g. kg -> pcs) — the UI never offers
// that choice, so hitting this means a caller bug, not bad user input.
export function convertUnitQuantity(value: number, fromUnit: Unit, toUnit: Unit): number {
  if (fromUnit === toUnit) return value;
  if (UNIT_FAMILY[fromUnit] !== UNIT_FAMILY[toUnit]) {
    throw new Error(`Cannot convert ${fromUnit} to ${toUnit} — different measurement families`);
  }
  const inReference = value * UNIT_TO_FAMILY_REFERENCE[fromUnit];
  const converted = inReference / UNIT_TO_FAMILY_REFERENCE[toUnit];
  // Round away binary floating-point noise (e.g. 4.75 * 1000 / 1000).
  return Math.round(converted * 1e6) / 1e6;
}

// RAW_MATERIAL: can be used as a recipe ingredient.
// FINISHED_GOOD: can be the output of a recipe, sold, or invoiced.
// Purely functional — separate from Category, which is just for browsing.
export enum ProductType {
  RAW_MATERIAL = "RAW_MATERIAL",
  FINISHED_GOOD = "FINISHED_GOOD",
}

export const PRODUCT_TYPE_LABELS_RU: Record<ProductType, string> = {
  [ProductType.RAW_MATERIAL]: "Сырьё",
  [ProductType.FINISHED_GOOD]: "Готовая продукция",
};

export interface CategoryDto {
  id: string;
  name: string;
  isActive: boolean;
  productCount: number;
}

export interface CreateCategoryRequestDto {
  name: string;
}

export interface UpdateCategoryRequestDto {
  name: string;
}

export interface ProductDto {
  id: string;
  name: string;
  sku: string;
  // The barcode printed on the packaging, read by a scanner at the till.
  // Null for own fresh production, which has none — see Product.barcode.
  barcode: string | null;
  // NTIN from Kazakhstan's National Catalogue of Goods (НКТ). Required on
  // every fiscal receipt line by law since
  // 01.01.2026, so a product without one cannot be legally rung up once
  // fiscalisation is switched on.
  ntin: string | null;
  unit: Unit;
  type: ProductType;
  categoryId: string | null;
  categoryName: string | null;
  price: number;
  isActive: boolean;
  // False for resources with no physical stock to track (e.g. tap water) —
  // see inventory.ts / InventoryService for what this suppresses. Selling
  // such a product also skips the stock check entirely.
  trackInventory: boolean;
  // The till's «Произвольная сумма» line: the cashier types the amount and
  // it becomes the line's unitPrice, so `price` (always 0) means nothing
  // here. At most one per organization — the POS hides it from the product
  // grid and offers it as its own button instead.
  isOpenPrice: boolean;
  // Goods taken «под реализацию» — somebody else's stock on our shelf. Both
  // fields are set together: the supplier we owe, and how much per unit sold.
  // Null on our own goods.
  consignmentSupplierId: string | null;
  consignmentSupplierName: string | null;
  consignmentPrice: number | null;
  // What this product costs at the point of sale the list was requested for
  // (`GET /products?locationId=…`). Equal to `price` unless that location has
  // its own price, and always equal to `price` when no location was asked
  // for. The till reads THIS, never `price` — `price` is the organization's
  // default, which at this business is the wholesale one.
  effectivePrice: number;
  // Low-stock threshold: StockLevelDto.isLow is true once quantity drops to
  // or below this. 0 (the default) means "alert only when fully out" —
  // fine for finished goods made to order, but raw materials usually want
  // a real number so purchasing gets a heads-up before they run out.
  minQuantity: number;
}

// One row of the «Цены по точке» screen: the organization's default price
// next to what this one point of sale charges.
export interface LocationPriceRowDto {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  // Product.price — the default, unchanged by anything on that screen.
  basePrice: number;
  // Null means "no own price here", i.e. this point charges basePrice.
  locationPrice: number | null;
}

export interface SetLocationPriceRequestDto {
  price: number;
}

export interface CreateProductRequestDto {
  name: string;
  sku?: string;
  barcode?: string;
  ntin?: string;
  unit: Unit;
  type: ProductType;
  categoryId?: string;
  price: number;
  trackInventory?: boolean;
  minQuantity?: number;
  consignmentSupplierId?: string | null;
  consignmentPrice?: number | null;
}

export interface UpdateProductRequestDto {
  name?: string;
  sku?: string;
  barcode?: string | null;
  ntin?: string | null;
  unit?: Unit;
  type?: ProductType;
  categoryId?: string | null;
  price?: number;
  trackInventory?: boolean;
  minQuantity?: number;
  // Null clears the consignment link — the product becomes our own goods
  // again. Already-recorded debt is unaffected: it lives on the sale lines.
  consignmentSupplierId?: string | null;
  consignmentPrice?: number | null;
}
