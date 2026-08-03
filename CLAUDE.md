# ArAmir OS — agent context

Real, in-production ERP for an actual bakery-network business ("Ar-Amir",
shown in-app as "ArAmir OS"; demo/seed org name is "Пекарня «Колосок»").
This file is what a fresh session needs to work on this repo effectively
without prior conversation history — the "why" behind decisions that isn't
obvious from the code alone. For setup/run instructions see `README.md`.

## Production deployment (current, as of the GitHub account migration)

The user moved development from an old GitHub account (`keremetAI`, repo
`keremetAI/repo`) to this one (`Odysseusex/New-OS`). Render/Vercel/Neon were
originally connected to the old account. Current state:

- **Frontend — Vercel project `repo-web-jzvl`**, domain
  `https://repo-web-jzvl-virid.vercel.app` — connected to `Odysseusex/New-OS`,
  auto-deploys on push to `main`. **This is the one to use/tell the user
  about.**
- **Old Vercel project `repo-web`**, domain `https://repo-web-kohl.vercel.app`
  — still connected to the old `keremetAI/repo`, does NOT receive this
  session's pushes. Stale/deprecated; don't debug "why isn't my change
  showing up" against this domain — check which domain the user is actually
  looking at first (this exact confusion cost a full debugging round once).
- **Backend — Render service `bakery-os-api`**, `https://bakery-os-api.onrender.com`
  (routes prefixed `/api`) — connected to `Odysseusex/New-OS`, tracks `main`
  directly (unlike an earlier setup, there is no second branch to
  fast-forward here — see Verification workflow below).
- **Database — Neon**, unchanged through the migration; both the old and new
  frontend point at the same `DATABASE_URL`, so user accounts/data are
  identical regardless of which frontend domain is used.
- Two env vars are the most common source of "it's live but doesn't work":
  - Render's `WEB_ORIGIN` must exactly equal the frontend's production
    domain (CORS) — a mismatch surfaces as a generic "Не удалось войти"
    with no other clue.
  - Vercel's `NEXT_PUBLIC_API_URL` must include the `/api` suffix
    (`https://bakery-os-api.onrender.com/api`) — omitting it surfaces as
    `Cannot POST /auth/login` (request hits the backend without its global
    prefix).
- Render's GitHub deployment credential could not be re-pointed from the old
  `keremetAI` account to `Odysseusex` — disconnecting it and reconnecting
  under the new account's active browser session still resolved back to the
  old account every time (root cause not found; likely a stale GitHub App
  installation on Render's side). Workaround in place: the repo is public,
  so Render clones it unauthenticated ("we don't have access... but we'll
  try anyway" in build logs is expected, not an error). Don't spend time
  re-litigating this unless the user asks to revisit it — they explicitly
  decided to leave it as-is.

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

**`Product.trackInventory`** (default `true`) opts a product out of the
entire stock-level system — for resources with no physical
receiving/counting (tap water, etc.). When `false`: excluded from
`StockLevel` queries and low-stock alerts, receive/write-off/adjust are
blocked (`InventoryService.assertTrackable`), and production-batch
consumption skips it entirely (no stock check, no `StockMovement` row) —
but it's still priced into recipe cost via its `price` column. Don't add
a second flag for "opt out of alerts only"; that's what `minQuantity = 0`
already means (see below).

**Stock corrections are a new ledger entry, never an edit.** `StockMovement`
is append-only (see Single ledger above) — so "I received the wrong
product" or "I made a typo" is fixed via `InventoryService.adjust()`
(type `ADJUSTMENT`), not by editing/deleting the mistaken row. The caller
states the true counted quantity; the service computes and stores the
signed difference. Same principle applies to `ProductionBatch.cancel()`
when aborting an `IN_PROGRESS` batch — it records why (`cancelReason`),
it doesn't rewrite what already happened.

**`Product.minQuantity`** is a real, user-set low-stock threshold, not a
derived value. `0` means "no threshold — never alert", which matters:
`isStockLow()` in `packages/shared/src/inventory.ts` is `minQuantity > 0
&& quantity <= minQuantity`, centralized there specifically because it
used to be duplicated (and briefly inconsistent) across
`InventoryService` and `LocationsService`. Editing a product's
`minQuantity` cascades to every existing `StockLevel` row for that
product (`ProductsService.update`) — it's one number per product even
though the schema still tracks it per-location, and every code path that
creates a new `StockLevel` row (manual receive/adjust, PO receipt,
invoice confirm, production output, route delivery — five call sites)
must seed it from the product, not leave it at the column default.

**Recipe process steps are a universal stage/parameter model, not
hardcoded bread fields.** Org-scoped `RecipeStageType` catalog (like
Category) + ordered `RecipeStage` instances per recipe (free-text `note`)
+ a small fixed `RecipeParameterKind` enum (TEMPERATURE_C,
DURATION_MINUTES, PERCENT, WEIGHT_G, COUNT) attachable to any stage with
an optional disambiguating `label`. Deliberately flat — no ingredient
grouping/sub-recipes/role tags; the real technical cards reviewed didn't
justify that complexity. Don't add a 6th parameter kind or a new
structural concept without a fresh, explicit request backed by real
cards — this was already argued through in depth once.

**Recipe ingredient quantities**: typed in whichever unit is convenient
(g/ml), converted and stored in the product's base unit via
`convertUnitQuantity()`/`getCompatibleUnits()` in
`packages/shared/src/catalog.ts`. Recipe economics (`Экономика` section)
recompute live from current form state as you type — not from the last
saved `recipe` prop — so yield/loss/ingredient edits update cost and
margin before saving. `totalIngredientCost` (whole batch) and `unitCost`
(per finished unit, what margin is actually computed against) are
surfaced as two distinct numbers; don't collapse them back into one
"Себестоимость" — that's the exact confusion that prompted splitting
them.

**Production batches have a real lifecycle**, not just PLANNED →
COMPLETED/CANCELLED. Statuses: PLANNED (editable: `scheduledFor` +
`plannedQuantity`, cancellable, deletable) → IN_PROGRESS (via `start()`;
locked from edit/delete) → COMPLETED or CANCELLED. `complete()` requires
IN_PROGRESS (not PLANNED) — the UI must call `start()` first. Aborting an
IN_PROGRESS batch reuses `cancel()` but requires a reason
(`ProductionCancelReason`); cancelling a still-PLANNED one doesn't. The
batch list defaults to an "Активные" filter (PLANNED ∪ IN_PROGRESS) so
finished/cancelled batches don't clutter the working view — this was a
deliberate refinement of what was asked, not scope creep.

**Roles are additive array membership, not a permission engine.** Adding
a role (e.g. `OPERATOR` — document work: purchase orders, supplier
invoices, sales/накладные — without inventory correction, recipes, users,
or settings) means adding the enum value plus inserting it into exactly
the `*_MANAGE_ROLES`/`*_VIEW_ROLES` arrays it needs in
`packages/shared/src/roles.ts`; **viewing is open to any authenticated
role by default in this app** (most GET routes carry no `@Roles(...)` at
all — `CustomersController` is a rare exception, class-level-gated) — so
granting "view sales/stock/map/reports" usually means doing nothing,
not adding a new `*_VIEW_ROLES` array. Don't build a granular
per-permission ACL/checkbox system; this two-tier array model has covered
every real request so far.

**Per-user display `title`** (optional, on `User`) overrides the role
label only in the topbar — permissions are still 100% determined by
`role`, and the Settings employee table always shows the real role,
deliberately, so access levels stay legible to whoever's looking. Don't
rename a role's own `ROLE_LABELS_RU` entry to give one person a custom
title; that changes it everywhere the role is displayed (Settings table,
role dropdowns) for every user with that role, and reintroduces the exact
non-Russian-UI bug this field was added to fix (a prior hardcoded
`role === OWNER ? "App Owner" : ...` override in `topbar.tsx`).

That said, a genuine global rename of a role's `ROLE_LABELS_RU` entry (not
a one-person override) is fine when explicitly requested — the org's owner
had `OWNER` relabeled from "Владелец" to "Разработчик" everywhere (Settings
table, role dropdowns, and the two hardcoded error/tooltip strings that
also said "Владелец" in `users.service.ts` and `row-actions.tsx`). The
`OWNER` enum value and every permission array are untouched; only the
Russian label changed. Don't revert this without being asked.

**Brand color is one CSS custom property.** `--accent` in
`apps/web/src/app/globals.css` (consumed everywhere via Tailwind's
`accent`/`accent-foreground` tokens — never hardcoded hex in components)
plus the matching PWA `theme_color` in `manifest.ts` and
`layout.tsx`'s `viewport.themeColor`, which should be changed together.
`city-map.tsx`'s per-location-type marker colors are a separate
categorical palette (STORE/PRODUCTION/WAREHOUSE/CUSTOMER) — don't touch
those for a brand color change just because one of them happens to reuse
the same old hex.

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
6. Commit, push to whatever branch this session was assigned, **then
   fast-forward `main` to match** — both Vercel (frontend, project
   `repo-web-jzvl`) and Render (backend, `bakery-os-api`) deploy from
   `main` on this repo, so a single fast-forward is enough (see
   "Production deployment" above; this used to require a second branch
   for Render under the old GitHub account's setup — no longer the case
   here).
   ```bash
   git push -u origin <this-session's-branch>
   git fetch origin main && git checkout main && \
   git merge --ff-only <this-session's-branch> && git push origin main
   git checkout <this-session's-branch>
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
- **`pkill -f "next start"` can miss the actual running process** — the
  real process shows up in `ps aux` as `next-server (vX.Y.Z)`, not
  `next start`, so a pattern that only matches the launch command can
  leave the old server alive on the same port. If you then `rm -rf .next`
  and rebuild while that old process is still serving requests, the
  browser gets stale chunk hashes (`Loading chunk N failed`, minified
  React error #423). Always confirm with a bare `ps aux | grep next` (and
  `kill -9` the PID directly) before rebuilding, not just a pattern-based
  `pkill`.
- **Bare `npx next start` can silently resolve a different, newer Next.js
  than the one in this repo's `node_modules`** (it printed "installing
  next@16.2.12" once, versus the repo's pinned 14.2.35) if invoked from a
  slightly wrong `cwd` or if the local binary lookup fails for any reason.
  Prefer `./node_modules/.bin/next start` from inside `apps/web` to
  guarantee the pinned version runs.
- **Background `cmd1 && cmd2 &` runs `cmd1` (including any `cd`) in a
  forked subshell**, so it does not change the calling shell's working
  directory even though it looks like it should. Don't chain a `cd` into
  a backgrounded command and then assume later commands in the same
  session inherited that directory — check `pwd` if unsure.

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
