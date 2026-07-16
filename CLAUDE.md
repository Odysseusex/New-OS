# ArAmir OS — agent context

Real, in-production ERP for an actual bakery-network business ("Ar-Amir",
shown in-app as "ArAmir OS"; demo/seed org name is "Пекарня «Колосок»").
This file is what a fresh session needs to work on this repo effectively
without prior conversation history — the "why" behind decisions that isn't
obvious from the code alone. For setup/run instructions see `README.md`.

## Non-negotiable conventions

- **UI is 100% Russian.** Every label, button, error message, placeholder —
  Russian. Code (variables, types, comments, commit messages) is English.
- **Communication with the user is simple and non-technical.** They are the
  business owner, not a developer — no jargon, explain trade-offs in plain
  terms. They write informally in Russian and may address you as
  "бро"/"родной" — that's just their tone, not a cue to change how you work.
- **Don't add scope beyond what's asked.** AI-центр and Интеграции modules
  are explicitly deferred (AI: cost concerns; Integrations: no real
  connector credentials) — do not start either without a fresh, explicit
  request. When a placeholder module's description promises something that
  isn't realistically buildable here (e.g. scheduled email dispatch with no
  SMTP provider, a full drag-and-drop report builder), say so and scope
  down rather than building a fake version of it.
- When an architectural call is ambiguous, explain the trade-off and either
  ask (`AskUserQuestion`) or state your reasoning and proceed — the user
  consistently prefers a reasoned recommendation over being asked to choose
  between options they don't have context for.

## Monorepo layout

```
apps/web/      Next.js 14 App Router — UI (Russian)
apps/api/      NestJS — backend API
packages/shared/  Types, DTOs, Role constants shared by both
```

`packages/shared` compiles to CommonJS (`dist/`) and is consumed via
`main`/`types` in its `package.json` (Node 22 otherwise tries to run the
package's `.ts` as native ESM and fails on extensionless relative imports).
**Any edit under `packages/shared/src` requires `pnpm --filter @bakery-os/shared build`**
before the change is visible to either app — this is the single most common
"why isn't my change showing up" cause.

Local Postgres cluster stops between sessions/turns — always
`sudo pg_ctlcluster 16 main start` first. DB is `bakery_os` on
`localhost:5432`, credentials in `apps/api/.env`. Demo users/passwords are
in `README.md`.

## Architecture principles already established

**Single ledger.** `StockMovement` is the one append-only table every
stock-affecting flow writes to, linked via nullable FKs (`saleId`,
`batchId`, `purchaseOrderId`, `routeStopId`, `invoiceId`) plus a
`writeOffReason` enum for categorizing write-off-type rows. Never build a
parallel table to track stock-affecting events — extend this one.

**Reference entities vs. transactional documents.** Reference entities
(Product, Category, Location, Customer, Supplier, Vehicle, Recipe, User)
get full CRUD + archive/restore + a guarded hard-delete. Transactional
documents (Sale, PurchaseOrder, Invoice, ProductionBatch) are immutable
once confirmed/received — only cancellable while still in an early state
(DRAFT/PLACED/PLANNED). Don't add edit/delete to a confirmed document;
add a new movement/adjustment instead.

**Two-tier RBAC.** Broad `*_MANAGE_ROLES` arrays (create/edit/archive) vs.
narrow `HARD_DELETE_ROLES = [OWNER, ADMIN]` (permanent delete only). All in
`packages/shared/src/roles.ts`. Every entity's `@Roles(...)` on its DELETE
route should be `HARD_DELETE_ROLES`, not the broader manage-roles array.

**`Product.type` (RAW_MATERIAL vs FINISHED_GOOD) changes what `price` means.**
For FINISHED_GOOD it's the client sale price. For RAW_MATERIAL it's the
cost input consumed by recipe cost calculations — it is NOT a sale price,
even though it's the same DB column. The product form's price label/hint
is already conditional on type (`new-product-modal.tsx`) — follow that
pattern rather than assuming one universal meaning for "price".

**Recipe cost calculation is already live**, not a future feature — do not
re-propose building it. `RecipesService.toDto()` computes `unitCost` from
`Σ(ingredient.quantity × ingredient.price) / effectiveYield` (loss-adjusted).
`FinanceService.getProfitAndLoss()` uses the same recipe-based cost as the
primary source, falling back to weighted-average actual purchase price
(from `PurchaseOrderItem`) for products with no active recipe, and reports
`hasCostData: false` when neither is available.

**Notifications are computed live, never stored as static rows.**
`NotificationsService` derives alerts on every request from canonical
data (low stock, customers over credit limit, stale purchase
orders/invoices, overdue production batches). `NotificationDismissal`
tracks only per-user dismissal, keyed by `{type}:{entityId}:{YYYY-MM-DD}` —
the date bucket means "dismiss" only silences today; a persisting problem
resurfaces the next day instead of being hidden forever.

**Reports reuse each module's own endpoint** (Finance P&L, Quality
summary, HR KPI, Inventory stock levels, plus one added Sales aggregation)
rather than duplicating access control or aggregation logic in a separate
reporting service. Tabs on `/reports` are filtered by the same role
constants each source module already uses.

**Product SKU** is optional; if blank, `ProductsService.generateSku()`
atomically increments `Organization.productSkuSequence` (a single
`UPDATE ... increment`, not a retry loop) and formats
`{ING|PRD}-{seq:06d}`. Manual SKUs are still fully supported and preserved.

## Prisma migration workflow (this sandbox has no direct prod DB access)

Shadow-database diff, not `prisma migrate dev` (which can hang/prompt):

```bash
psql -h localhost -U postgres -c "CREATE DATABASE bakery_os_shadow;"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@localhost:5432/bakery_os_shadow" \
  --script > migration.sql
# move migration.sql into prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
npx prisma generate
psql -h localhost -U postgres -c "DROP DATABASE bakery_os_shadow;"
```

Always review the generated SQL is additive (no unexpected drops) before
deploying.

## Verification workflow — do this before calling anything done

1. Rebuild `packages/shared` if touched.
2. `npx tsc --noEmit` in both `apps/api` and `apps/web`.
3. Full build: `npx nest build` (api), `rm -rf .next && npx next build` (web).
4. Kill any stale `nest start`/`next dev`/`next-server`/`dist/src/main`
   processes before restarting dev servers — **running a full `next build`
   while `next dev` is still watching the same `.next` directory corrupts
   it** (RSC-payload mismatch, `__webpack_modules__[moduleId] is not a
   function`, infinite "Загрузка…"). Always stop `next dev`, build, then
   restart `next dev` fresh if you need both.
5. Browser-test the actual flow with Playwright
   (`executablePath: "/opt/pw-browsers/chromium"`, run scripts with
   `NODE_PATH=/opt/node22/lib/node_modules node script.js` since Playwright
   isn't in this repo's own `node_modules`). Screenshot and actually look
   at it — don't infer success from HTTP status alone.
6. Commit, push to `claude/bakery-platform-design-khuzwz`, then
   fast-forward `main` to match (Render/Vercel deploy from `main`):
   ```bash
   git fetch origin main && git checkout main && \
   git merge --ff-only claude/bakery-platform-design-khuzwz && \
   git push origin main && git checkout claude/bakery-platform-design-khuzwz
   ```

## Known bug classes worth checking for when touching similar code

- **Modal mount race condition:** a modal that seeds row/field state from
  `parentList[0]?.id ?? ""` at `useState` initializer time breaks silently
  if the parent's async list fetch hasn't resolved yet when the modal
  opens. Fix: initialize empty, add a `useEffect` that backfills once the
  list arrives, only if the field is still empty (don't clobber user edits).
  Hit and fixed repeatedly in sale/purchase-order/invoice/stock-movement
  modals — check any new modal that takes a list as a prop.
- **Empty-body POST responses break the frontend's `request()` helper:**
  it always calls `res.json()`; a NestJS handler returning `void`/`undefined`
  produces an empty body that throws on parse, surfacing as a generic
  fallback error even though the request succeeded server-side. Always
  return a small object (e.g. `{ dismissed: true }`) from otherwise-void
  endpoints, matching the existing `{ deleted: true }` convention for
  DELETE routes.

## Module status

All primary-nav modules are `status: "live"` in `apps/web/src/lib/nav.ts`
except `/ai` and `/integrations` (`"soon"`, intentionally deferred — see
above). Everything else — Dashboard, Sales, Production/Recipes (with
техкарты), Inventory, Procurement (with Invoices), Logistics, Map, Finance,
HR, Quality и списания, Customers, Network, Reports, Notifications,
Settings/Users — is fully implemented, not a placeholder.

One deferred design decision, not yet revisited: `DeliveryRoute`/`RouteStop`
only reference own Locations, not Customers directly — a sale to a
wholesale customer goes through the source location rather than a
route stop. Revisit only if asked.
