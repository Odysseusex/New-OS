# Semi-finished products (полуфабрикаты) — design

Status: **Stage 1 BUILT** (virtual semi-finished products: calculation + automatic raw consumption).
Stage 2 (stocked intermediates) is NOT built. Packaging as a recipe ingredient is NOT built (the owner
did not decide it; the workaround is a raw item «Упаковка»). No «Полуфабрикаты» category was created.

Built as designed, with these specifics:
* Migration `20261013120000_product_type_semi_finished` (one enum value). Nothing existing changes.
* `apps/api/src/recipes/recipe-tree.ts` is the single place for nested cost / expansion / loop checks;
  `common/product-costs.ts`, `RecipesService` and `ProductionService.complete` all use it.
  `CostingService` was NOT edited.
* A recipe's yield is stored to 0.001 of the unit (850.85 g is entered as 0.851 kg).
* Max 4 recipe levels in a chain, root included (трайфл → крем → заварной крем = 3).
* A semi-finished ingredient must have an active recipe; a recipe other recipes use cannot be archived/deleted.
* A semi-finished product is forced to `trackInventory = false`, cannot be consignment, cannot be sold
  (till, API) or bought (purchase orders, invoices), and has no production batch of its own.
* A product that was already sold or moved cannot be turned into one; one used in a recipe cannot stop being one.

## Why

Real technical cards (трайфл «Наполеон») are 3 levels deep: заварной крем → крем «Дипломат» → трайфл,
plus коржи with their own yield. Today a recipe ingredient must be `RAW_MATERIAL`
(`recipes.service.ts` `assertValidIngredients`), so such a card has to be flattened by hand into
raw quantities per one piece. That works and is exact (the trufle card flattened to 763.02 ₸, equal to
the sheet), but it does not scale and shows no cost of the intermediate (1 kg of cream, 1 kg of crumbs).

CLAUDE.md said recipes stay flat "until real cards justify more". These cards are that case.

## Model

* `ProductType` += `SEMI_FINISHED` («Полуфабрикат»). SKU prefix `SEM`. Not sellable (the till and
  `ProductsService` already filter on `FINISHED_GOOD`), not purchasable.
* A semi-finished product has its own `Recipe` (same table, same yield/loss/stages) — `yieldQuantity`
  is the sellable output AFTER normal loss (D1), so "802 g of raw cooked into 1000 g" and "1001 g of
  raw dough baked into 850.85 g" are just that recipe's yield.
* A recipe ingredient may be `RAW_MATERIAL` or `SEMI_FINISHED`. Quantity is in the ingredient's own
  unit (g/kg conversion already exists). Not `PACKAGING`, not `FINISHED_GOOD`.
* No new tables. One enum value.

## Cost (one function, not three)

Recipe cost is computed in three places today and they must not diverge:
`RecipesService.toDto`, `common/product-costs.ts` (`resolveProductUnitCosts`), and
`ProductionService.complete` (`ingredientTotal`). Replace the flat sum by ONE shared resolver:

    unitCost(product) = Σ item.quantity × ingredientUnitCost(item) / recipe.yieldQuantity
    ingredientUnitCost = RAW → Product.price ; SEMI → unitCost(that product)   (recursive, memoised)

`CostingService` needs NO edit: it already takes `resolveProductUnitCosts` for every non-raw product,
so a semi-finished product (and every finished good using it) is valued through the same
interface. D2 is untouched; the semi-finished cost is "recipe at today's ingredient prices", exactly
how finished goods are costed today (per-receipt moving average is still not built).

Guards on save: no cycles (A uses B uses A), max depth 4, an ingredient SEMI must have an active recipe,
otherwise its cost is unknown and the parent says so (never zero).

## Production — two stages

**Stage 1 (recommended first): virtual, expanded at consumption.** A semi-finished product has
`trackInventory = false` (the existing flag). Completing a batch of the parent expands the nested
recipe to the leaf raw materials: stock is checked and `PRODUCTION_CONSUMPTION` rows are written per
raw material (scaled by the parent quantity × the semi-finished yield), cost stamped as today. Nothing
is held as stock of the intermediate. This is what flattening by hand does, automated, and it keeps the
single stock ledger and every ledger/period rule exactly as they are.

**Stage 2 (only if the owner needs it): stocked.** `trackInventory = true` on a semi-finished product
means its own batch (existing `ProductionBatch`) produces stock of it, and the parent batch consumes that
stock ("Недостаточно полуфабриката…"). Needs: cost of consumed semi-finished stamped from its output
row, write-off of leftover (existing write-off), and a check that the general-ledger events chain
raw → semi-finished → finished without losing value. Larger, riskier, not needed for pricing.

## Touch points

| Area | Change |
|---|---|
| `schema.prisma` + migration | `ALTER TYPE "ProductType" ADD VALUE 'SEMI_FINISHED'` (additive) |
| `packages/shared` | enum, label «Полуфабрикат», SKU prefix, type rank in classification |
| `recipes.service.ts` | allow RAW + SEMI ingredients; cycle/depth check; DTO shows the ingredient's unit cost |
| `common/product-costs.ts` | recursive resolver (shared by recipes, costing, production) |
| `production.service.ts` | expand SEMI to leaves for stock check, consumption rows and cost |
| `products.service.ts` | type select; category must be of its own type (existing rule) |
| classification | the type «Полуфабрикат» is rejected/accepted by the same type-match rule |
| web | product form type; recipe picker lists П/Ф; «Экономика» shows an П/Ф line and its own cost; the П/Ф recipe page |
| notifications, replenishment, ABC | already skip `trackInventory = false` items |
| sales, POS, P&L | none — a semi-finished product is never sold; its cost reaches P&L through the finished good |

## Not changed

`CostingService`, prices, existing recipes, existing sales/stock, the standard catalogue (no new
category is added without the owner's approval), packaging accounting.

## Decisions for the owner

1. Stage 1 only (calculation + automatic raw consumption), or stocked intermediates too?
2. Packaging in the card (both sample cards include it): allow `PACKAGING` as a recipe ingredient,
   consumed from stock? Today it cannot be; the workaround is a raw item «Упаковка».
3. Category for semi-finished items («Полуфабрикаты»): create it, yes/no.
