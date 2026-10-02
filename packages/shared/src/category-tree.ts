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

// ── the starting catalogue for ArAmir Bakery ─────────────────────────────
// Offered, never applied on its own: an owner chooses to add it, and it only
// ever ADDS — nothing existing is renamed, moved or reclassified, and no
// product is assigned to any of it.
export interface StandardCatalogCategory {
  type: ProductType;
  name: string;
  subcategories: string[];
}

export const STANDARD_CATEGORY_CATALOG: StandardCatalogCategory[] = [
  { type: ProductType.RAW_MATERIAL, name: "Бакалея", subcategories: ["Мука пшеничная", "Мука ржаная", "Сахар", "Сахарная пудра", "Крахмал", "Сухие смеси", "Крупы", "Макаронные изделия", "Соль", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Молочная продукция", subcategories: ["Молоко", "Сливки", "Масло сливочное", "Сметана", "Творог", "Сыр", "Сухое молоко", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Яйца", subcategories: ["Яйцо куриное", "Меланж", "Яичный порошок", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Масла и жиры", subcategories: ["Растительное масло", "Маргарин", "Спред", "Кондитерские жиры", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Кондитерское сырьё", subcategories: ["Шоколад", "Какао", "Глазурь", "Карамель", "Сиропы", "Джемы", "Повидло", "Начинки", "Орехи", "Сухофрукты", "Мак", "Кокос", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Дрожжи и разрыхлители", subcategories: ["Дрожжи свежие", "Дрожжи сухие", "Разрыхлитель", "Сода", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Добавки и ингредиенты", subcategories: ["Специи", "Ароматизаторы", "Красители", "Загустители", "Стабилизаторы", "Эмульгаторы", "Улучшители", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Мясо и птица", subcategories: ["Мясо", "Птица", "Колбасные изделия", "Мясные начинки", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Рыба и морепродукты", subcategories: ["Рыба", "Морепродукты", "Рыбные начинки", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Овощи и фрукты", subcategories: ["Овощи", "Фрукты", "Ягоды", "Зелень", "Замороженные овощи/фрукты", "Другое"] },
  { type: ProductType.RAW_MATERIAL, name: "Прочее сырьё", subcategories: ["Другое"] },

  { type: ProductType.PACKAGING, name: "Пакеты", subcategories: ["Пакеты", "Пакеты с логотипом", "Пакеты прочие"] },
  { type: ProductType.PACKAGING, name: "Коробки", subcategories: ["Коробки для хлеба", "Коробки для выпечки", "Коробки для тортов", "Коробки прочие"] },
  { type: ProductType.PACKAGING, name: "Контейнеры", subcategories: ["Пластиковые контейнеры", "Контейнеры для десертов", "Контейнеры прочие"] },
  { type: ProductType.PACKAGING, name: "Этикетки и маркировка", subcategories: ["Этикетки", "Ценники", "Стикеры", "Маркировка"] },
  { type: ProductType.PACKAGING, name: "Прочая упаковка", subcategories: ["Плёнка", "Фольга", "Бумага", "Пергамент", "Скотч", "Другое"] },

  { type: ProductType.FINISHED_GOOD, name: "Хлеб", subcategories: ["Батон", "Белый хлеб", "Ржано-пшеничный хлеб", "Ржаной хлеб", "Цельнозерновой хлеб", "Авторский хлеб", "Прочий хлеб"] },
  { type: ProductType.FINISHED_GOOD, name: "Выпечка", subcategories: ["Булочки", "Круассаны", "Слойки", "Пирожки", "Самса", "Лепёшки", "Прочая выпечка"] },
  { type: ProductType.FINISHED_GOOD, name: "Пироги", subcategories: ["Сладкие пироги", "Пироги с мясом", "Пироги с овощами", "Прочие пироги"] },
  { type: ProductType.FINISHED_GOOD, name: "Кондитерские изделия", subcategories: ["Торты", "Пирожные", "Десерты", "Печенье", "Кексы", "Маффины", "Прочая кондитерка"] },
  { type: ProductType.FINISHED_GOOD, name: "Готовая кулинария", subcategories: ["Сэндвичи", "Салаты", "Готовые блюда", "Прочее"] },
  { type: ProductType.FINISHED_GOOD, name: "Прочая готовая продукция", subcategories: ["Другое"] },
];
