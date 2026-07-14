export enum Unit {
  PCS = "PCS",
  KG = "KG",
  G = "G",
  L = "L",
}

export const UNIT_LABELS_RU: Record<Unit, string> = {
  [Unit.PCS]: "шт",
  [Unit.KG]: "кг",
  [Unit.G]: "г",
  [Unit.L]: "л",
};

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
  unit: Unit;
  type: ProductType;
  categoryId: string | null;
  categoryName: string | null;
  price: number;
  isActive: boolean;
}

export interface CreateProductRequestDto {
  name: string;
  sku: string;
  unit: Unit;
  type: ProductType;
  categoryId?: string;
  price: number;
}

export interface UpdateProductRequestDto {
  name?: string;
  sku?: string;
  unit?: Unit;
  type?: ProductType;
  categoryId?: string | null;
  price?: number;
}
