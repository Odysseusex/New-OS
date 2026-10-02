import { ProductType } from "./catalog";
import type { CategoryDto } from "./catalog";

// Category → Subcategory → Product, inside a product type. Pure helpers shared
// by the API (descendant filters, coupon rules) and the web (selectors, tree),
// so both sides read the hierarchy the same way.

type Node = Pick<CategoryDto, "id" | "parentId">;

// The category itself plus every subcategory under it. Selecting a parent in
// any filter means «the parent and everything below it».
export function categoryIdsWithDescendants(categories: Node[], categoryId: string): string[] {
  const out = [categoryId];
  for (const c of categories) {
    if (c.parentId === categoryId) out.push(c.id);
  }
  return out;
}

// «Родитель › Подкатегория», or just the name for a top-level category.
export function categoryPathLabel(
  category: { id: string; name: string; parentId: string | null },
  all: { id: string; name: string }[],
): string {
  if (!category.parentId) return category.name;
  const parent = all.find((c) => c.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

// The value attached to a product's category by a rule table (a coupon's
// per-category discount), where a rule on a subcategory wins over one on its
// parent, and a rule on the parent covers every subcategory under it.
export function resolveCategoryRule<T>(
  rules: Map<string, T>,
  categoryId: string | null | undefined,
  parentOf: (categoryId: string) => string | null | undefined,
): T | undefined {
  if (!categoryId) return undefined;
  const own = rules.get(categoryId);
  if (own !== undefined) return own;
  const parentId = parentOf(categoryId);
  return parentId ? rules.get(parentId) : undefined;
}

// A category may hold a product of `productType` when it is of that type, or
// when it predates types (null) and is therefore open to any.
export function categoryAcceptsType(categoryType: ProductType | null, productType: ProductType): boolean {
  return categoryType === null || categoryType === productType;
}

export interface CategoryTreeNode {
  category: CategoryDto;
  children: CategoryDto[];
}

export interface CategoryTypeGroup {
  // Null is the group of legacy categories with no type yet.
  type: ProductType | null;
  nodes: CategoryTreeNode[];
}

// Type → top-level categories → subcategories, in the order the lists already
// use (sortOrder first, unplaced last, then by name — the API returns them so).
// A subcategory whose parent is missing from the list (archived and hidden) is
// kept visible as its own top-level node rather than disappearing.
export function buildCategoryTree(categories: CategoryDto[], typeOrder: ProductType[]): CategoryTypeGroup[] {
  const ids = new Set(categories.map((c) => c.id));
  const childrenOf = new Map<string, CategoryDto[]>();
  const tops: CategoryDto[] = [];
  for (const c of categories) {
    if (c.parentId && ids.has(c.parentId)) {
      childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c]);
    } else {
      tops.push(c);
    }
  }
  const nodesOf = (type: ProductType | null): CategoryTreeNode[] =>
    tops.filter((c) => c.type === type).map((category) => ({ category, children: childrenOf.get(category.id) ?? [] }));
  // Every real type is always a group, even when empty, so a category can be
  // started under it; the untyped legacy group only appears when it has members.
  const groups: CategoryTypeGroup[] = typeOrder.map((type) => ({ type, nodes: nodesOf(type) }));
  const legacy = nodesOf(null);
  if (legacy.length > 0) groups.push({ type: null, nodes: legacy });
  return groups;
}

// How two category names are compared when deciding whether a category already
// exists: ignoring case, surrounding spaces, repeated spaces and a trailing «…»
// or full stop. «кондитерские изделия» and «Кондитерские изделия», or «Пицца,
// роллы, блины…» and «Пицца, роллы, блины», are the same category.
export function normalizeCategoryName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[….]+$/u, "")
    .trim()
    .toLowerCase();
}

// ── the starting catalogue for ArAmir Bakery ─────────────────────────────
// The approved TOP-LEVEL categories of each product type, nothing below them.
// Offered, never applied on its own: an owner chooses to add it, and it only ever
// ADDS — nothing existing is renamed, moved or reclassified, and no product is
// assigned to any of it. Subcategories are not part of it on purpose (no
// «Другое»/«Прочий…» filler): they are created by a classification, where a
// product really needs one.
export interface StandardCatalogCategory {
  type: ProductType;
  name: string;
}

export const STANDARD_CATEGORY_CATALOG: StandardCatalogCategory[] = [
  { type: ProductType.RAW_MATERIAL, name: "Бакалея" },
  { type: ProductType.RAW_MATERIAL, name: "Молочная продукция" },
  { type: ProductType.RAW_MATERIAL, name: "Яйца" },
  { type: ProductType.RAW_MATERIAL, name: "Масла и жиры" },
  { type: ProductType.RAW_MATERIAL, name: "Кондитерское сырьё" },
  { type: ProductType.RAW_MATERIAL, name: "Дрожжи и разрыхлители" },
  { type: ProductType.RAW_MATERIAL, name: "Добавки и ингредиенты" },
  { type: ProductType.RAW_MATERIAL, name: "Мясо и птица" },
  { type: ProductType.RAW_MATERIAL, name: "Рыба и морепродукты" },
  { type: ProductType.RAW_MATERIAL, name: "Овощи и фрукты" },
  { type: ProductType.RAW_MATERIAL, name: "Прочее сырьё" },

  { type: ProductType.PACKAGING, name: "Пакеты" },
  { type: ProductType.PACKAGING, name: "Коробки" },
  { type: ProductType.PACKAGING, name: "Контейнеры" },
  { type: ProductType.PACKAGING, name: "Этикетки и маркировка" },
  { type: ProductType.PACKAGING, name: "Упаковочные материалы" },

  { type: ProductType.FINISHED_GOOD, name: "Хлеб" },
  { type: ProductType.FINISHED_GOOD, name: "Выпечка" },
  { type: ProductType.FINISHED_GOOD, name: "Пироги" },
  { type: ProductType.FINISHED_GOOD, name: "Торты" },
  { type: ProductType.FINISHED_GOOD, name: "Пицца, роллы, блины" },
  { type: ProductType.FINISHED_GOOD, name: "Кондитерские изделия" },
  { type: ProductType.FINISHED_GOOD, name: "Готовая кулинария" },
];
