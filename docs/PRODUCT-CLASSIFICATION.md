# Product classification: Type → Category → Subcategory → Product

Migrations `20261003090000_product_type_packaging` and `20261003090100_category_hierarchy`.
Not applied to production by this work — they run when `main` is deployed
(Render's build runs `prisma migrate deploy`).

## What changed

**Product type** now has three values: `RAW_MATERIAL`, `PACKAGING` (new), `FINISHED_GOOD`.
Existing products keep their type. Packaging is a stock item: bought, received,
counted, written off like any other. It is **not** a recipe ingredient (recipes
still accept only `RAW_MATERIAL`, so nothing needed changing there), not sold at
the till and not on the price list (finished goods only). `CostingService` is
untouched: a packaging product is costed like any non-raw product — the weighted
average of what was actually received, otherwise *unknown* (never zero). Its
`price` is a reference figure; no accounting treatment of packaging was invented.

**Category** gained `type` (nullable) and `parentId` (nullable, self-reference).
`isActive` already served as "archived" and was kept. The tree is **two levels**:
a parent must itself be top-level, active and typed; a subcategory has its
parent's type. Product → category attachment is unchanged (`Product.categoryId`);
a product may sit in a category or a subcategory.

Name uniqueness: siblings are unique (`organizationId, parentId, name`), and
**top-level names stay unique across the organization** exactly as before (a
partial unique index `WHERE "parentId" IS NULL` — Postgres treats NULLs in the
ordinary constraint as distinct). That is what lets «Другое» exist under many
parents while a top-level name can never be duplicated.

## Existing data

Nothing is deleted, moved, renamed or reclassified; every id and every
`products.categoryId` is preserved (verified: before/after dumps of both tables
are byte-identical apart from the new columns).

* Existing categories become top-level. Each gets `type` **deterministically
  from the products it holds** — all of one type → that type; empty or mixed →
  `NULL` ("legacy", shown under «Без типа (прежние категории)»). Never from names.
  The statement is marked `[deterministic-typing]` in the migration and is
  exercised by `category-hierarchy.spec.ts` inside a rolled-back transaction.
* A legacy untyped category is open to products of any type until someone gives
  it a type, which is refused while it holds products of another type.
* Existing products are **not** reassigned. Reclassification is gradual and manual.
* The standard catalogue (below) is offered, not applied.

## Standard catalogue

Defined once in `packages/shared/src/category-tree.ts` (`STANDARD_CATEGORY_CATALOG`).
Where: Склад → Категории → «Стандартный каталог» (OWNER/ADMIN), with a preview.
It only **adds**. A top-level name that already exists with the same type is
reused as the parent (missing subcategories are added under it); a name that
exists with another type, no type, or archived is **skipped and reported**.
Audited as `category.seedStandard`. Idempotent.

## Behaviour that follows the tree

* Filtering by a category means it **and its subcategories**: sales demand report,
  stocktake by category, Склад → Категории product list, POS tabs (a second row
  of subcategory chips), reports filter.
* Coupons: a rule on a category also covers its subcategories; a rule on the
  subcategory itself wins (`resolveCategoryRule`, same lookup on server and POS).
* Anywhere a category name is shown (stock, stocktake, price list, AI export,
  promotion rules) it reads «Бакалея › Мука пшеничная».
* Product form: Тип → Категория (only that type's, plus legacy untyped) →
  Подкатегория. The API enforces the same pairs.

## Historical reporting — the category-at-sale problem

Before this work **no snapshot existed**: the sales report filtered by the
product's *current* category, so re-filing a product silently moved all of its
past sales between categories.

Now `SaleItem.categoryIdSnapshot` (nullable, plain id with no FK) records the
product's category (the leaf) when the sale is made. The category filter of the
sales report reads the snapshot and falls back to the product's current category
**only for legacy lines, where it is NULL**. Existing sales were deliberately not
back-filled; they are the legacy rows and remain exactly as ambiguous as before.

Reports that read a product's category by its *current* value (legacy lines only,
for the sales report) and nothing else: `SalesService.demandAnalysis`. Every other
consumer (POS, stocktake, price list, promotions' per-category discount report,
AI export) is live/operational and correctly uses the current category.

Not snapshotted yet (do it when the first category report is built):
`SaleReturnItem`, `StockMovement` (for COGS / inventory-value by category),
`PurchaseOrderItem` (purchase spend by raw-material category).

## Not touched

`CostingService`, P&L, balance, ДДС, general ledger, journal, AP/AR, tax. Category
is a management dimension, never an accounting account. `FinanceCategory` (expense
categories) is a different, unrelated table.

## Future analytics (not built)

The hierarchy makes these possible without further schema work for new data:
revenue / COGS / gross profit / margin by category or subcategory (sale lines +
snapshot), purchase spend by raw-material category, inventory value by category
(`CostingService` × current category), ABC by category, turnover by category.
Use `categoryIdsWithDescendants()` for roll-ups and snapshot the category onto
any new row that needs history-stable grouping.

## Packaging — future integration point

Production consumes recipe ingredients only. Packaging consumption (a box per
batch/unit) would be an explicit new concept in the recipe/production model
(a packaging line on the recipe, consumed with a `StockMovement`), with its own
cost decision. It is deliberately **not** built; `PACKAGING` products can be
purchased, received, counted and written off today.
