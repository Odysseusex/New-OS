import type { ProductType } from "./catalog";

// Classification batches: a file of «артикул → категория › подкатегория» that an
// owner PREVIEWS, APPLIES and can UNDO. It changes only a product's category
// (and may create categories/subcategories). The product is found by SKU — the
// name in the file is only a cross-check — and nothing else about it changes:
// not its type, price, cost, stock, nor whether it is sold «под реализацию».

// One row of the uploaded file, exactly as typed (the server normalises it).
export interface ClassificationRowInput {
  sku: string;
  // Only compared with the product's name, to warn about a wrong SKU.
  name?: string;
  // «Сырьё» / «Упаковка» / «Готовая продукция» (or the enum name). It is
  // checked against the product's type, never applied.
  type?: string;
  category?: string;
  subcategory?: string;
}

export interface ClassificationPreviewRequestDto {
  rows: ClassificationRowInput[];
}

export interface ClassificationApplyRequestDto {
  rows: ClassificationRowInput[];
  // Taken from the preview. If the data moved on since, the apply is refused and
  // the preview must be run again.
  fingerprint: string;
  // Apply the valid rows even though some rows were rejected.
  acceptRejected?: boolean;
  note?: string;
}

export type ClassificationRowStatus = "MOVE" | "UNCHANGED" | "SKIP" | "REJECT";

export interface ClassificationPreviewRowDto {
  line: number;
  sku: string;
  fileName: string | null;
  productId: string | null;
  productName: string | null;
  productType: ProductType | null;
  // «Категория › Подкатегория», or null when the product has none.
  currentPath: string | null;
  targetPath: string | null;
  status: ClassificationRowStatus;
  // Why a row is SKIP or REJECT.
  reason: string | null;
  // Something worth a look on a row that is still applied (e.g. a differing name).
  warning: string | null;
}

export interface ClassificationCategoryToCreateDto {
  type: ProductType;
  name: string;
  // Null for a top-level category.
  parentName: string | null;
}

// An active promotion whose rule sits on a category that would lose products.
export interface ClassificationPromotionImpactDto {
  promotionId: string;
  promotionName: string;
  categoryName: string;
  productsLeaving: number;
}

export interface ClassificationPreviewDto {
  fingerprint: string;
  rows: ClassificationPreviewRowDto[];
  summary: {
    rows: number;
    toMove: number;
    unchanged: number;
    skipped: number;
    rejected: number;
    categoriesToCreate: number;
    subcategoriesToCreate: number;
    // Active products that are not in the file at all (left exactly as they are).
    productsNotInFile: number;
  };
  categoriesToCreate: ClassificationCategoryToCreateDto[];
  promotions: ClassificationPromotionImpactDto[];
}

export type ClassificationBatchStatusDto = "APPLIED" | "PARTIALLY_REVERTED" | "REVERTED";

export interface ClassificationBatchDto {
  id: string;
  createdAt: string;
  createdByName: string;
  note: string | null;
  status: ClassificationBatchStatusDto;
  productsMoved: number;
  productsRestored: number;
  categoriesCreated: number;
  revertedAt: string | null;
}

export interface ClassificationRevertRequestDto {
  // Also delete the categories this batch created that are still completely
  // empty (no products, no subcategories, no promotion rules).
  removeEmptyCategories?: boolean;
}

export interface ClassificationRevertResultDto {
  batch: ClassificationBatchDto;
  restored: number;
  conflicts: { sku: string; productName: string; reason: string }[];
  categoriesRemoved: number;
}
