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
  business owner, not a developer — no *engineering* jargon, explain
  trade-offs in plain terms. They write informally in Russian and may
  address you as "бро"/"родной" — that's just their tone, not a cue to
  change how you work. This is about *software* vocabulary only — it does
  NOT extend to domain terminology, see next point.
- **Never simplify professional financial/management-accounting terms in
  the UI.** The owner uses ArAmir OS to learn финансовый и управленческий
  учёт, so the real term is the feature. Use "Точка безубыточности", not
  "Нужно выручки в месяц"; "Маржинальная прибыль", "Маржинальность",
  "Постоянные затраты", "Переменные затраты", "Выручка", "Себестоимость",
  "Дебиторская/Кредиторская задолженность", "P&L / Прибыли и убытки",
  "ДДС / Денежный поток", "ФЗП", "План/Факт". Don't simplify terminology
  without a fresh, explicit request; this was corrected once already.
- **…but don't explain the terms in the UI either.** This is a working ERP
  panel, not a textbook. A stat card is exactly *term + value + unit*
  ("Плановый ФЗП" / "1 150 000 ₸/мес.") — no descriptive subtitle under it,
  no intro paragraph above a section, no "что это значит" helper prose.
  Both halves of this rule were learned the hard way in one session: first
  terms got paraphrased into conversational Russian, then the correction
  overshot into per-card glossary lines that had to be stripped out again.
  What legitimately stays is a *data* message, not a *teaching* one: a
  warning that the figures are incomplete ("Не учтено в плановом ФЗП" plus
  the affected employees), an unclassified-costs alert, a status line
  explaining why a number is withheld, or a one-line consequence warning at
  the point of action inside a modal. If a term genuinely needs teaching,
  that belongs in documentation, not on the panel.
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

**Reports charts (recharts).** `recharts` sat in `package.json` unused for a
long time — the customer-sales-trend line chart (`Отчёты → Динамика`) is the
first real chart in the app, so treat it as the established pattern rather
than a one-off: `SalesTrendChart` component
(`apps/web/src/components/sales-trend-chart.tsx`) mounts the chart only after
`useEffect` marks the client hydrated (recharts measures the DOM, so SSR
would otherwise produce a hydration mismatch), and reads CSS custom
properties (`var(--accent)`, `var(--border)`, `var(--muted)`) for styling
rather than hardcoded colors, matching the brand-color rule above. Backend
day-by-day bucketing (`SalesService.customerTrend()`) always emits one point
per calendar day in the range, zero-filled — a gap in a time series reads as
"no data" when it should read as "genuinely zero" — via `zonedDateKey()` /
`zonedDateKeysBetween()`, bucketed in `Asia/Almaty` (`REPORTING_TIME_ZONE`
constant), not the server's UTC. Period-over-period comparison reuses
`deltaPct()` from `apps/api/src/common/period-range.ts` (new sibling helper
`previousRangeOf()` added alongside the existing `currentAndPreviousPeriod()`
for endpoints that take an arbitrary `from`/`to` instead of a day count).

**Client-side searchable pickers.** Established pattern, used twice
(`stock-movement-modal.tsx`'s `ProductSelect`, and the search box on
`Склад → Номенклатура`): the full list is already loaded client-side
(`api.products.list()` has no pagination), so filtering is a plain
case-insensitive substring match (`name.toLowerCase().includes(query)`) —
matching anywhere in the string, not just a prefix — with **no debounce and
no new request**. Reuse this pattern for the next searchable list rather than
reaching for a library or a backend search endpoint. A custom dropdown
rendered inside a `Modal` must intercept `Escape` in the **capture phase**
(`document.addEventListener("keydown", handler, true)`), not a plain React
`onKeyDown` — Next.js App Router hydrates React's own event delegation on
`document` too, so a bubble-phase `stopPropagation()` inside the dropdown
cannot stop the Modal's sibling `document` listener from also firing and
closing the whole form. Hit and fixed once in `stock-movement-modal.tsx`;
check for it in any future custom-dropdown-inside-Modal.

**Brand color is one CSS custom property.** `--accent` in
`apps/web/src/app/globals.css` (consumed everywhere via Tailwind's
`accent`/`accent-foreground` tokens — never hardcoded hex in components)
plus the matching PWA `theme_color` in `manifest.ts` and
`layout.tsx`'s `viewport.themeColor`, which should be changed together.
`city-map.tsx`'s per-location-type marker colors are a separate
categorical palette (STORE/PRODUCTION/WAREHOUSE/CUSTOMER) — don't touch
those for a brand color change just because one of them happens to reuse
the same old hex.

## Telegram bot (additional interface, not primary nav)

A fully non-AI (zero LLM cost) Telegram bot at `apps/api/src/telegram/`,
webhook-based (`POST /api/telegram/webhook`, via Telegraf), covering all six
sections (Склад, Продажи, Клиенты, Финансы, Аналитика, Производство) plus
account linking and low-stock push notifications. It is **shipped and
stable**, not a work-in-progress — don't re-propose building any of this.
Deliberately excluded per explicit user decision: invoices/накладные,
print/PDF.

**Core design, don't relitigate:**
- **RBAC reuse, not duplication.** `telegram-bot.service.ts` calls the same
  NestJS services in-process (DI, not HTTP) and manually re-checks each
  route's `@Roles(...)` via the same shared arrays from
  `packages/shared/src/roles.ts` — a Telegram user can never exceed their web
  account's permissions.
- **Idempotent writes via `TelegramPendingAction`**: stage → confirm →
  execute, with `claim()`'s single conditional `UPDATE ... WHERE status =
  'PENDING'` as the only real correctness guarantee (only the request that
  flips the row wins). Every write goes through `stageAction()` /
  `confirmAction()` / `cancelAction()`. This same staged-write pattern is
  worth reusing for the fiscalization work below.
- **One evolving screen per chat**, not a message per step —
  `TelegramChatState.lastMessageId` tracks the single message `reply()`
  edits in place; push notifications (`sendMessage()`) deliberately bypass
  this since they're unsolicited and must not overwrite an in-progress
  wizard. `TelegramChatState.clear()` resets only `step`, never
  `lastMessageId`.
- **Every confirm/cancel outcome carries navigation buttons** ("🔁 Ещё раз" /
  "🏠 Главное меню") — added specifically because early versions left the
  user stuck retyping `/start` after every operation. `resultKeyboard()` maps
  each `actionType` to its own "repeat" callback.
- **`requireStep()` guards every continuation callback** against a stale
  inline button from an already-finished/abandoned wizard resuming with
  corrupted state (this caused a real FK-violation bug once — a stale button
  sent the literal string `"undefined"` as a `locationId`).

Known-fixed bug classes worth re-checking if you touch this file: Telegraf's
lazy internal `getMe()` call happens *before* any app-level try/catch (fix:
warm `botInfo` in `onModuleInit`, wrap `handleUpdate()`); `ctx.answerCbQuery`
throws synchronously so a bare `if (ctx.answerCbQuery)` guard is useless (use
the `ackCallback()` helper, which checks `ctx.callbackQuery` instead); and
`confirmAction`'s write-execution and its result-message `reply()` **must be
in separate try/catch blocks** — combining them means a reply failure (e.g. a
Telegram hiccup) incorrectly rolls an already-successful write back to
FAILED.

## Fiscal cash register (ККМ) integration — research done, code NOT started

Real legal requirement for retail sales in Kazakhstan (fiscal receipts via a
certified online cash register + ОФД), not a nice-to-have — first real point
of sale is the wholesale customer "Мерей". Provider chosen after comparing
Webkassa / E-Kassa / re:Kassa: **re:Kassa**, mainly because it's the only one
with public confirmation of state ККМ-registry registration (№253) and a
short, explicit path to API docs. **Do not re-run that comparison** — see
this session's transcript if the reasoning is needed again.

**Current blocker: their API documentation**, which is closed until
requested. The user is emailing them; a self-service path may also exist at
`app.rekassa.kz/access-api` ("Сторонние приложения") — check there first.
**Also unresolved and asked in the same email: what hardware is actually
required.** re:Kassa's own docs call it an "аппаратно-программный комплекс,"
which could mean an ordinary Android tablet + receipt printer is enough, or
could mean a specific certified device is mandatory — this is not yet known
and must not be guessed. If it turns out a specific certified device is
required, that changes the whole shape of the integration (a device-bound
kассa can't just be "our backend calls their cloud API"), so this is the
single highest-risk open question, above every code question.

**The two-phase sale order is BUILT, behind an off-by-default switch.**
`FISCALIZATION_ENABLED` (env, must be exactly the string `"true"`) is the
whole of the deployment step and the whole of the rollback. While off,
`SalesService.create()` runs the original single transaction untouched and
no fiscal code is reached at all — there is a test asserting exactly that,
including that a half-set flag (`"1"`, `"yes"`) fails safe to off.

**Receipt first, then the sale — not the other way round.** The obvious
design (write the `Sale`, then fiscalise, then cash/stock) was rejected: it
needs a `Sale` that isn't a real sale yet, and then every revenue query
across the six modules that touch `prisma.sale`/`tx.sale` (sales, customers,
locations, finance, ai, hr) has to learn to exclude it. Instead
`fiscalizeBeforeSale()` validates, punches the receipt, and only then runs
the existing transaction unchanged. The invariant stays trivial: **a `Sale`
row in this database is always a completed sale.** Consequences to keep in
mind before changing this:
- `FiscalReceipt.saleId` is nullable *because* the receipt predates the sale.
  A REGISTERED receipt with `saleId = null` means it was punched and the sale
  then failed to record — the one hole this order leaves, deliberately
  surfaced by `needsAttention()` rather than hidden.
- `FiscalReceipt.requestPayload` stores what was sent. A retry must resend
  byte-identical content under the same `externalId`, and after a timeout
  there is no sale row to rebuild it from. JSON has no `Date`, so
  `restoreRequest()` revives `occurredAt` — sending it on as a string would
  stamp the receipt wrong.
- Stock is checked *before* fiscalising as well as inside the transaction, so
  a legally binding receipt is never issued for goods the stock check is
  about to refuse a moment later.
- An UNKNOWN outcome tells the cashier **not** to ring the cart up again
  ("Не пробивайте заново"), because a second attempt could punch a second
  receipt. That wording is load-bearing, not decoration.

**VERIFIED against re:Kassa's live test environment** (test ЗНМ, sandbox at
`app-test.rekassa.kz/partner`; credentials live in the gitignored
`apps/api/.env`, never in code). Real receipts were punched end-to-end from
the POS screen. What this settled, so it is not re-investigated:

- **Idempotency is real.** Two calls with the same `X-Request-ID` returned
  the identical `ticketNumber` and ticket id — no second receipt. This is
  the assumption the whole UNKNOWN-retry design rests on, and it now holds
  against their server rather than only against `FakeFiscalProvider`.
- **`ReKassaProvider` parses their real response correctly** — `ticketNumber`,
  `qrCode`, `shiftNumber`, `offline` all landed; money and quantity encoding
  round-trip exactly (`1 шт × 590.00 = 590.00 ₸` came back verbatim).
  `kgdKkmId` comes back null at top level (it sits at
  `data.ticket.service.regInfo.kkm.fnsKkmId`); harmless, not worth chasing
  unless something needs it.
- **Lookup by ticket id works**: `GET /api/crs/{crId}/tickets/{id}` returns
  the whole receipt including our `externalId`. That is the missing piece
  for reconciliation — resolving an UNKNOWN row no longer needs new
  information from re:Kassa, only the code to be written.
- **The test server does NOT validate `ntin` at all** — it accepted invented
  digits and even a non-numeric string. Do not read that as "the code is
  optional": it is a legal requirement and the production operator is a
  different question. It does mean integration work is not blocked on НКТ
  registration.
- Login returns `id` (the cash register id used in the ticket URL) and
  `timeOffset: "+05:00"`, confirming `RECEIPT_TIME_ZONE = "Asia/Almaty"`.

**Terminology bug, not yet fixed:** the UI label and the fiscal error
messages say «код ИКПУ». ИКПУ is **Uzbekistan's** term (their catalogue is
`tasnif.soliq.uz`). Kazakhstan's is **NTIN**, from the НКТ — Национальный
каталог товаров (`nationalcatalog.kz`), with **XTIN** as the temporary code
issued while a product card is still being moderated. The Prisma field is
already correctly named `ntin`; only the user-facing Russian strings are
wrong (`new-product-modal.tsx`, `fiscal.service.ts`). The user was told and
has not yet said whether to rename — ask before doing it.

**Still not built**: a shift (смена) lifecycle, the reconciliation job that
uses the lookup above, return receipts, the «Требует внимания» screen, and
showing the receipt number/QR on the POS after payment. **Do not switch
`FISCALIZATION_ENABLED` on in production** — a sandbox receipt is not a
production one, and the org on the test kassa is re:Kassa's own
("TOO COMRUN"), not the user's ИП. Production needs its own ЗНМ, password
and base URL, and real NTIN codes on the products being sold.

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
- **A failed request must never render identically to a genuine empty
  result.** A `.catch()` that just sets the data state to `null` makes a real
  500/network error look exactly like "this customer has zero sales this
  month" — which is exactly what happened with the customer-trend card: a
  stale-backend 404 (see the Render bullet below) rendered as the same
  quiet "Нет данных за период" a real zero would, so the actual failure was
  invisible until directly investigated. Track loading / error / empty as
  three distinct states, and show the real server message on error.
- **A date range computed with `new Date()` plainly during render is a new
  object on every render**, and if a `useEffect`'s dependency array derives
  from it (e.g. `range.to.toISOString()`), the effect re-fires every render
  — including the request it just started, before it can resolve. This
  produced a genuine 1000+ requests/10s loop in the customer-trend card that
  a fast localhost response masked entirely (the chart still appeared before
  the next re-render fired) — it only became visible against a slower real
  network. Wrap any render-time "now"-derived range in `useMemo`.
- **A 401 on an authenticated route proves the route exists no more than a
  404 would disprove it, when a `:id`-catchall route shares a controller
  with a named one.** `GET /sales/:id` and `GET /sales/customer-trend` sit
  behind the same `JwtAuthGuard`, so an unauthenticated probe against either
  returns 401 regardless of whether `customer-trend` is actually registered
  — a stale-deploy 404-via-catchall and a real 404 are indistinguishable
  without a valid token. The actual tell, once authenticated, was the error
  message itself: "Продажа не найдена" is `findOne()`'s NotFoundException,
  and it only appears if the literal string `"customer-trend"` got matched
  as a Sale id — i.e. the newer named route wasn't registered on whatever
  code Render was actually running (a stale/failed auto-deploy), not a code
  bug. When a route that should exist behaves like a sibling `:id` route
  instead, suspect a stale backend deploy before suspecting the new code.

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

Beyond the web app's own nav, there's a second shipped interface: the
**Telegram bot** (see its own section above) — fully live, not a
placeholder. **Fiscal cash register (ККМ) integration is the one active,
not-yet-started thread** — research and architecture are done (own section
above), code has not begun, blocked on re:Kassa's API docs and a hardware
question. Don't start writing it without checking that section first.
