# ArAmir OS — agent context

Real, in-production ERP for an actual bakery-network business ("Ar-Amir",
shown in-app as "ArAmir OS"; demo/seed org name is "Пекарня «Колосок»").
This file is what a fresh session needs to work on this repo effectively
without prior conversation history — the "why" behind decisions that isn't
obvious from the code alone. For setup/run instructions see `README.md`. For the current state of work and open decisions see `docs/HANDOFF.md`.

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
- **Because of that link, Render's auto-deploy never fires** (every deploy in its
  Events was «Manually triggered»). Fix in place: `.github/workflows/render-deploy.yml`
  calls Render's Deploy Hook on every push to `main` that touches the API/shared
  code (or by hand: Actions → «Deploy API to Render» → Run workflow). It needs the
  repository secret `RENDER_DEPLOY_HOOK_URL` (Render → Settings → Deploy Hook) —
  the owner adds it; never ask for the URL in chat, it is a deploy credential.

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
`Σ(ingredient.quantity × ingredient cost) / yield`, where a raw material's cost is its moving
weighted average (`rawMaterialUnitCost`, see «Raw materials at a moving weighted average» below).
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

**P&L product drill-down.** A row of Финансы → «Финансовый результат по товарам» opens `ProductPnlModal`
(`GET /finance/pnl/product`, `FinanceService.getProductPnlDetail`): the same totals computed line for line like
`getProfitAndLoss` (a spec asserts they match), plus cost source (stamped basis / today's cost / none), unit cost
over time, prices sold at, per location, and the active техкарта priced per ingredient. Always live, even for a
frozen month (sale lines carry their own cost stamp).

**Stock history is its own tab** (Склад → «Движения», `StockMovementsTab`): period / type / location / product
filters on `GET /inventory/movements` (no filter = the latest 50 as before, e.g. the Telegram bot; with a period or a
product up to `STOCK_MOVEMENTS_MAX` rows). Clicking a balance row on «Остатки» opens that product's history. Each row
shows the cost stamped on the movement (`unitCost`, `costAmount`) and, for sales/returns, the buyer's average price per
unit on that document (`salePrice`).

**Stocktake (Склад → «Инвентаризация») for a store of raw materials:** created per location and optionally per
`productType` (and category); while COUNTING it is **blind** for anyone outside `STOCKTAKE_APPROVE_ROLES` — the server
withholds `systemQuantity`/differences/values (`StocktakeDto.blind`), so a counter cannot fit the count to the books;
approvers always see everything. Counts are typed as expressions read by shared `parseCountInput` («3*25+12» sacks,
«350г» for a kg product, never eval'd, null = not understood); Enter moves to the next field. «Печать бланка» prints the
same two-column blind sheet as «Сверка дня» (`apps/web/src/lib/count-sheet.ts`, shared by both). A user tied to one
location can only pick that location.

**One period control for reports** (`components/period-picker.tsx` + `lib/period.ts`): Отчёты, Финансы (Сводка, P&L,
Точка безубыточности), Качество, Сеть точек (Сравнение), Персонал (KPI) share presets (Сегодня … Прошлый месяц … Год) and
«Период» с … по … . The value is a plain string (`PeriodValue`: a preset or `custom_YYYY-MM-DD_YYYY-MM-DD`) so it drops into
effect deps and CSV names; `periodRange()` gives Almaty days — a range including today ends now, a closed one at the end
of its last day, so «Прошлый месяц» matches `matchWholeMonth` and a closed month is served from its snapshot.
Отчёты → «Динамика по клиенту» and Склад → «Движения» keep their own controls.

**Screen scale per device** (`lib/ui-scale.ts`, `components/ui-scale-control.tsx`, «− 100% +» on the till): a monoblock
whose Windows cannot go below 100 % showed the till too large. It sets the root font size (the app is in rem, so text,
spacing and buttons scale together; viewport heights stay whole), kept in that browser's localStorage and applied before
first paint by an inline script in the root layout (`<html suppressHydrationWarning>`; the public `/ar-amir` site is never
scaled). The till's width cap is in px (`max-w-[1280px]`) so a smaller scale does not make the till narrower.

**A till redesign was tried and rolled back (07.11.2026).** After a Dribbble-style rebuild of /pos (coral accent,
photo cards, own rail, commit 8936c4b) the owner asked for the previous till back the same day; it was reverted whole.
Don't redo a till restyle without a fresh request. Learned on the way: Tailwind opacity modifiers on the theme colours
(`bg-accent/10`, `border-accent/40`, `text-muted/70`) generate NOTHING here — the colours are plain `var()` without
`<alpha-value>` — so such classes in existing screens are silent no-ops.

**Scrolling the till's grid on the monoblock** (cashier's complaint: scrolling by dragging over tiles added products):
`components/pos-scroll.tsx` — `useTapGuard` on the grid counts a press as a tap only if the finger moved < 12 px and the
page did not scroll (a browser-taken pan = `pointercancel` = no tap); a MOUSE drag over the grid scrolls the page by hand
(cheap touch panels report the finger as a mouse and have no native drag-scroll); `select-none`, images not draggable.
`ScrollButtons` = big sticky «вверх / вниз» under the grid (lg and up).

**Till digit pad** (`components/numeric-keypad.tsx`): the till's monoblocks will have the system on-screen keyboard
switched off, so every DIGIT entry on the till uses our own pad — no <input> behind it (nothing pops the system keyboard),
a physical keyboard/scanner still types into it. `PhoneKeypadModal` (+7 and ten digits, mask «+7 (7__) ___ __ __», a
leading 8 ignored), `PhoneField` (looks like an input, opens the pad), `NumberKeypadModal` (points to spend). Used by the
till's «Клиент бонусной программы», the top «Клиент» panel (`LoyaltyLookupPanel keypad`) and registration from the till
(`LoyaltyRegisterModal keypad`); Клиенты → Розница keeps plain inputs. A `Modal` opened over another answers Escape alone.
Letters: `components/text-keypad.tsx` (`TextKeypadModal`/`TextField`: the standard Kazakh layout — ӘІҢҒҮҰҚӨҺ on the top row, then ЙЦУКЕН (owner asked for exactly this), a capital at
each word start, ⇧ flips it) for names on the till — registration, the member card and birthdays (`LoyaltyFamilySection
keypad`: quick picks for «Кто это»). Deliberately big: small keys are missed on a touch screen.
Birthdays on the till: `components/birth-date-pad.tsx` — ДД.ММ(.ГГГГ) on the digit pad plus tappable month names
(«07 июл»), always read back in words; also offered right in till registration (saved as a «Сам клиент» row, name
«Клиент» when none). Every other till field is on a pad too: PIN (`PinPad`, dots), check discount, shift amounts
(`AmountField`) and comments (`TextField withDigits`), the till's return (`SaleReturnModal keypad`) and its history
search. Physical keys go to the TOP window's pad even while the till's scan field keeps focus (`isInTopWindow`); a real
input inside that same window keeps its own typing. Elsewhere month selects read «05 — мая».
CRM → client → «Изменить» (`components/crm/member-edit-dialog.tsx`): name, note, WhatsApp/Telegram consent (a new consent
row each change, source OTHER «Изменено в CRM»), birthdays add / correct (PATCH keeps `dateSetAt` unless the date changes)
/ remove; renaming the member renames its «Сам клиент» birthday named «Клиент». The phone is never edited.

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

**Keyboard flow for multi-line documents** (`lib/keyboard.ts`, owner on an iPad with a keyboard): Склад →
Приёмка/Списание/Корректировка, «Новый заказ поставщику», «Новая продажа», приёмка/исправление заказа.
- A line always has one empty line after it (`withTrailingRow`) — no «Добавить товар» button; empty lines are
  ignored on save.
- Enter in a field marked `{...enterNext}` moves to the next marked field of the form; a `ProductSelect` with
  `enterFlow` is OPENED when reached and, once a product is picked, moves on itself (product → кол-во → цена →
  next line's search). Enter with an empty search picks nothing; ↑/↓ move the highlight.
- ⌘/Ctrl+Enter in ANY `Modal` presses its `[data-submit]` button, else submits its form (`requestSubmit`, so
  validation runs). `SubmitShortcutHint` (components/, Tailwind does not scan lib/) shows «⌘↵»/«Ctrl+↵».
- Not on the recipe form (its quantity is `required`, an empty trailing line would block saving).

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
  the whole receipt including our `externalId`. Not currently used by our
  own reconciliation (see below) — kept in mind for a future admin
  "look up this specific ticket" feature, but reconcile() didn't need it.
- **The test server does NOT validate `ntin` at all** — it accepted invented
  digits and even a non-numeric string. Do not read that as "the code is
  optional": it is a legal requirement and the production operator is a
  different question. It does mean integration work is not blocked on НКТ
  registration.
- Login returns `id` (the cash register id used in the ticket URL) and
  `timeOffset: "+05:00"`, confirming `RECEIPT_TIME_ZONE = "Asia/Almaty"`.

**Terminology bug — FIXED.** The UI label and fiscal error messages used to
say «код ИКПУ». ИКПУ is Uzbekistan's term (their catalogue is
`tasnif.soliq.uz`). Kazakhstan's is **NTIN**, from the НКТ — Национальный
каталог товаров (`nationalcatalog.kz`), with **XTIN** as the temporary code
issued while a product card is still being moderated. The Prisma field was
already correctly named `ntin`; only the Russian strings were wrong, now
read «Код NTIN» / «Не заполнен код NTIN у товаров: …» throughout
(`new-product-modal.tsx`, `fiscal.service.ts`, plus comments in
`fiscal-provider.ts`, `schema.prisma`, `catalog.ts`, `products.service.ts`).
Two comments still say ИКПУ deliberately — they explain the mix-up itself,
not the field.

**Reconciliation is BUILT and VERIFIED against the live test kassa.**
`FiscalService.reconcile(organizationId)` retries every UNKNOWN receipt for
an org via the existing `attempt()` path — nothing more exotic. This works
*because* re:Kassa's idempotency was already proven live above: resending
the identical `requestPayload` under the same `externalId` either returns
the original ticket (the timeout happened after they had already
registered it) or genuinely tries again (it never reached them).
Deliberately does NOT touch FAILED (a stated rejection an unchanged retry
cannot fix) or a REGISTERED receipt with no `saleId` (the fiscal side
already succeeded; the missing sale needs a human). Exposed at
`GET /api/fiscal/needs-attention` and `POST /api/fiscal/reconcile`, both
gated to `HARD_DELETE_ROLES` (OWNER/ADMIN) via `FiscalController` — a
human-triggered check-in for now, not a cron; add one later once the
operator's shift cadence is understood. Live-verified end to end: punched
a real receipt directly, created a matching `UNKNOWN` row by hand
(simulating "we never saw the response"), called `reconcile()`, and it
came back `REGISTERED` with the exact ticket number already issued —
proving the self-heal works against their server, not only against
`FakeFiscalProvider`.

**The receipt number and QR are shown on the POS after payment.**
`SaleDetailDto.fiscalReceipt` is null when fiscalisation is off, so the
till keeps its original four-second green flash and nothing else changes;
with a receipt, `ReceiptPanel` renders the number plus a scannable QR and
**does not auto-dismiss** — it clears when the cashier closes it or starts
the next order, because a number that vanishes after four seconds is worse
than none. `SALE_DETAIL_INCLUDE` carries the receipt too, so the number
stays findable later rather than only in the seconds after payment.
`qrcode.react` is the QR library (first use in this repo); the QR is
deliberately hardcoded black-on-white rather than themed — it has to stay
high-contrast to survive a phone camera, and that is the one documented
exception to the "no hardcoded colors" rule. In `create()` the receipt is
attached to the DTO by hand, because it is linked to the sale *after* the
`sale` row was loaded, so the included relation on that object is null.

**Shift (смена) — investigated against the sandbox; closing is BLOCKED on
one question to re:Kassa.** What is now known for certain:

- `GET /api/crs/{crId}` returns the whole shift state without any extra
  call: `shiftNumber`, `shiftOpen`, `shiftOpenTime`, `shiftExpireTime`
  (exactly openTime + 24h), `shiftExpired`, `shiftDocumentNumber`. So
  *detecting* an expiring shift needs nothing new from them.
- Their API is HAL and advertises its own operations. `GET
  /api/crs/{crId}/shifts/{n}` returns `_links` with `close`
  (`…/shifts/{n}/close?withdrawMoney=false`), `xReport`
  (`…/reports/x` — an X-отчёт without closing), `operations`, `tickets`,
  `operatorsReport`, `sectionsReport`. Read those links rather than
  hardcoding paths.
- **`POST …/shifts/{n}/close` answers `WRONG_PASSWORD`.** It wants the cash
  register's own password, which is NOT the integration password. Login
  returns `cashRegisterPassword: "1111"`, but that value is rejected in the
  request body (as `password` and as `cashRegisterPassword`) and in
  `X-Cash-Register-Password` / `X-Password` headers; logging in with it
  instead of the integration password gives `ACCESS_DENIED`. **Do not keep
  guessing** — repeatedly posting wrong passwords at a fiscal operator is
  exactly what credential probing looks like. The open question for
  re:Kassa is narrow: *how is the cash register password passed to the
  shift-close endpoint?*
- Their own sandbox shifts ran **24.1h and 32.3h** before closing, so there
  is no strict auto-close at the 24h mark, but something does eventually
  close them. What happens to a receipt punched into an expired shift is
  still UNKNOWN and must not be assumed benign.

Until closing works, the mitigation is to *show* the state — which is built:
`FiscalProvider.getShiftState()` reads it, `FiscalService.status()` returns
it with the needs-attention count, and the «Фискальная касса» card on
Настройки renders it (OWNER/ADMIN only, matching the endpoints' own gate).
The card also lists problem receipts and has a «Сверить с кассой» button
wired to `reconcile()`. Verified live: a hand-made UNKNOWN row for a receipt
that really existed showed as «Ответ не получен», and the button turned it
into «Пробит» with the exact ticket number already issued — while still
flagging «Чек пробит, но продажа не записалась», which was true.

**Returns (возвраты) are BUILT and verified against the live test kassa.**
A `SaleReturn` is a separate append-only document referencing its `Sale`,
never an edit of it — the sale stays immutable like every other confirmed
document. Money and goods go through the same single ledgers as everything
else (`CashMovement.SALE_REFUND`, `StockMovement.SALE_RETURN`), reached via
nullable `saleReturnId` FKs rather than tables of their own. Partial and
repeated returns are the normal case: `create()` subtracts what earlier
returns already took back, so the same loaf can never be refunded twice, and
it refuses to refund more than the buyer actually paid.

`SaleReturn.restocked` decides whether the goods go back on the shelf or are
written off (`WRITE_OFF` + `OTHER`) — bread a buyer carried home cannot be
resold, and stock must not claim otherwise. Gated by `SALE_RETURN_ROLES`
(OWNER/ADMIN/STORE_MANAGER/SENIOR_CASHIER), deliberately *narrower* than SALE_CREATE_ROLES:
a cashier refunds only with a senior cashier's PIN (ТЗ §5.4, see «Кассовая смена»).

**The re:Kassa return payload, established empirically** (their docs were not
to hand, so this came from their own error messages — an empty `parentTicket`
makes them list the required fields by name):
- `operation: "OPERATION_SELL_RETURN"` plus a `parentTicket` block with
  `parentTicketNumber`, `parentTicketDataTime` (their spelling — "data", not
  "date"; renaming it fails), `kgdKkmId`, `parentTicketTotal`,
  `parentTicketIsOffline`.
- `amounts.taken` **must be 0** — nothing is handed over by a buyer being
  refunded; a non-zero value is rejected outright.
- `kgdKkmId` is the cash register's own `registrationNumber` from
  `GET /api/crs/{id}`, NOT a field of the ticket — this is why the receipt's
  own `kgdKkmId` column comes back null and why `ReKassaProvider` fetches and
  caches it instead. The earlier note that it was "harmless, not worth
  chasing" is what this turned out to need.
- A return is punched BEFORE the document is written, exactly like a sale, so
  a `SaleReturn` row always means money really went back. A sale with no
  registered receipt cannot be returned fiscally at all (nothing to quote) —
  refused with a plain Russian message rather than inventing a parent.
**Do not switch `FISCALIZATION_ENABLED` on in production** — a sandbox
receipt is not a production one, and the org on the test kassa is
re:Kassa's own ("TOO COMRUN"), not the user's ИП. Production needs its own
ЗНМ, password and base URL, and real NTIN codes on the products being sold.

## Accounting architecture (Phases 0–10) — what a fresh session must know

Phases 2–10 are merged and live on `main` (the general ledger code is deployed; it stays OFF per
organization until the owner/admin switches it on — see below). What changed and how to roll it out:
`docs/ACCOUNTING-PHASES-2-9.md`, `docs/PHASE-10-GENERAL-LEDGER.md`. The rules below are the ones that are easy to
break by accident:

- **No balance plug, ever.** `BalanceService` builds Assets/Liabilities from
  ledgers/registers/documents and Equity from its OWN history (declared
  opening + owner flows + accumulated result of events since go-live). It is
  never Assets − Liabilities. A disagreement is `NOT_BALANCED` with a separate
  CONTROL block of real comparisons; CONTROL never enters a total.
- **`FinancialEvent` is projected, never stored** (`finance/events/`). Rules for
  a category live in one place (`events/rules.ts`) and are read by the P&L, the
  cash-flow statement and the balance sheet alike. Invariants I1–I5 are in
  `events/invariants.ts`; an event whose counter-side is unknown is flagged
  `unclassified` and keeps only what it knows — nothing is invented for it.
- **One valuation interface: `CostingService`.** Cost is stamped on the sale
  line / stock movement / return line when the event happens (`unitCost`,
  `costBasis`) and history is read from the stamp. **D2 is APPROVED: weighted
  average.** It is applied where it is safe — a bought-in product is costed at
  the average of what was actually RECEIVED (RECEIVED orders at delivered
  quantity/cost + CONFIRMED invoices; a PLACED/CANCELLED order counts for
  nothing — it used to). **Baked goods are at the moving average of their batches**
  (ТЗ §5.1 «списание готовой продукции по средней себестоимости»; 05.11.2026): every completed
  batch of a tracked FINISHED_GOOD moves `Product.averageUnitCost` exactly like a stocked
  semi-finished product (`averagedOutput` in `ProductionService.complete`; before the first batch
  the existing stock is taken at today's recipe cost), sales/write-offs/transfers are stamped at
  that average (`CostingService` basis `PRODUCTION_AVERAGE`, `common/product-costs.ts`), and a
  restocked sale return folds back in at its stamp (`foldIntoProductionAverage`). It used to be
  TODAY's recipe: every raw-material price change revalued the shelf and the balance showed
  «не сходится» (found in the sandbox after a purchase-price revision; the ТЗ example spec step 7
  now guards it). The recipe card's cost/margin is still the recipe (planning). **Raw materials are at a moving weighted average of their
  priced receipts** (owner-approved, iiko-style): `Product.averageUnitCost`, moved by
  `costing/raw-material-average.ts` `recordRawMaterialPurchase()` — called BEFORE the
  stock is added, with a `FOR UPDATE` lock on the product, by Склад → Приёмка lines with
  a «Цена за ед.» (`unitPrice`, raw materials only, prefilled with the last price, a
  >50 % deviation from the average asks first), purchase-order receipts and invoice
  confirmations. It also sets `Product.price` to the latest purchase price. Before the
  first priced receipt the average is the card price, so stock on hand keeps its value;
  a receipt without a price, a return, a count or production comes in at the average
  and leaves it alone. `rawMaterialUnitCost(price, average)` (shared) is the one rule
  used by `CostingService` (basis `RAW_MATERIAL_AVERAGE`), `recipe-tree`, the recipe
  card and the recipe form. History is never recomputed (every row keeps its stamp).
  A product whose type changes loses its average. Do not add FIFO.
- **Decisions: approved vs not.** APPROVED — D1 (recipe `yieldQuantity` is the
  normal sellable output AFTER normal loss: unit cost = ingredients ÷ yield,
  `lossPercent` only suggests a yield and is never taken off again; abnormal loss
  is a write-off, never folded into product cost), D2 (above), D7 (card
  commission is a separate expense, never a revenue reduction — no code
  special-cases it, it is just a classified expense), D8 (a refund follows the
  original tender split proportionally, `sales/refund-allocation.ts`, explicit
  override via `refundSplit`). NOT approved, never defaulted — D3 opening
  completeness, D4 depreciation/capitalisation, D5 tax/VAT, D6 production cost
  components (`ABNORMAL_LOSS` exists as a component but is never written).
  Missing policy = NULL / «Не настроено» / PRELIMINARY / NOT_POSTED.
- **Purchasing is Order → Receive → Inventory → Pay supplier.** A payable exists
  only from receipt, only for orders received after `Organization.purchaseCutoverAt`
  (a one-way switch). New supplier invoices are refused after it; old ones stay
  readable/payable. Payments are `PurchaseOrderPayment` rows + cash movements,
  undone by reversal, never edited. Amount owed is derived, never stored.
- **Periods:** closing a month writes an immutable versioned `PeriodSnapshot`
  and freezes that month's reports; it does NOT stop current business. Writes
  dated inside a closed month are refused (`PeriodGuard`); owner-only reopen of
  the latest closed month, with a reason.
- **Fixed assets/depreciation assume nothing:** an asset depreciates only when
  method, life, salvage and start month are all stated on it. Runs are
  idempotent (unique row per asset+month).
- **Management layer (`/planning`) reads the books and writes only its own
  tables.** No LLM. The forecast has no tax driver (D5) and says so.
- **Every hand-wired spec misses DI.** `src/app-boot.spec.ts` compiles the whole
  `AppModule` so a provider the container cannot resolve fails in CI, not on
  the server (this caught a real boot failure).
- **Audit rows commit with the change** (`audited()` / `recordAudit(tx, …)`);
  master-data edits, archives and hard deletes are covered.

## General ledger (Phase 10) — double entry over the existing ledgers

`apps/api/src/ledger/`. Posted journal entries are the accounting source of truth
for what they cover; `StockMovement`/`CashMovement` stay the subledgers and
diagnostics compare the two. Rules that are easy to break:

- **OFF by default.** `Organization.ledgerStartsAt` null ⇒ every posting hook
  returns after one read and every flow behaves exactly as before. It is set once
  (owner/admin, after the system accounts exist). Events dated before it are
  NEVER converted automatically (`notMigrated` in coverage); the position at the
  start enters as ONE reviewed opening entry (`proposeOpening` is read-only).
- **The accounting rules are NOT restated in the ledger.** `FinancialEvent` (each
  proven to balance by invariant I1) is the single place a business fact's
  meaning lives; `ledger/posting-rules.ts` only maps its cash/balance/result legs
  to system accounts. A new kind of fact = a new event; it posts automatically.
  An event whose other side is unknown (`unclassified`) is NOT_POSTED with a
  reason — no suspense account, no plug, ever.
- **Only `journal-core.ts` creates journal rows.** Business modules call the plain
  function `postLedgerSources(tx, {organizationId, actorId, scope})` inside their
  own transaction (same pattern as `recordAudit`) naming the documents they just
  wrote — never lines. Expected conditions (unclassified, no account, closed
  period) become a NOT_POSTED `AccountingEvent`, never a failed sale; a genuine
  fault rolls the whole operation back. Every cash movement is hooked once, in
  `CashMovementsService.recordMovement`.
- **Idempotency** = `AccountingEvent` unique `(organizationId, eventKey)` + a
  per-key `pg_advisory_xact_lock`. One event → at most one STANDARD entry.
- **Immutability is in the database:** `UPDATE` on `journal_entries`/`journal_lines`
  is rejected by trigger; lines are CHECKed one-sided positive; all lines of an
  entry arrive in ONE `INSERT` and a statement-level trigger checks balance,
  ≥2 lines and "nothing added later". Corrections are reversals (unique
  `reversalOfEntryId`); a REVERSED event is never auto-reposted.
- **Posting is batched at the END of the transaction, never per hook.** Production
  incident: with the ledger ON, a POS sale failed with "Internal server error"
  (Prisma "Transaction not found") because posting at every hook (~60 round trips)
  outran Prisma's 5 s interactive-transaction limit. Now `postLedgerSources` only
  enqueues (`ledger/posting-queue.ts`, AsyncLocalStorage); `PrismaService.$transaction`
  (wrapper, default `maxWait 10 s / timeout 30 s`) runs ONE batched posting on the
  same transaction right before commit — still atomic. Always open business
  transactions through `PrismaService.$transaction`; pass `immediate: true` only
  where the summary is needed (catch-up, tests). `postEvents` is a fixed handful of
  queries however many events there are. Never add per-event queries back.
- **Do NOT use a deferred constraint trigger for balance.** Prisma swallows a
  failure at COMMIT: the transaction rolls back and the caller is told it
  succeeded (a sale that "worked" and does not exist). Reproduced while building
  this; hence the statement-level trigger.
- **Money is `Prisma.Decimal` end to end** (`journal-math.ts`): >2 decimals is
  an error, never a rounding. Event amounts (JS numbers, already `round2`) are
  snapped with `fromComputed`.
- **Statements from the ledger sit BESIDE the existing reports**, with
  `reconcilePnl` and the diagnostics comparing them; the owner-facing P&L/balance/ДДС
  are unchanged. The balance sheet check `A = L + E` is arithmetic; the real
  tests are the subledger reconciliations (inventory, AP, AR, cash, fixed assets).
- Dimensions (`locationId`, `productId`, `customerId`, `supplierId`…) are plain
  nullable columns on the line, not FKs, so they never block a guarded hard
  delete. Department / project / cost centre do not exist yet.
- Journal numbers come from an atomic increment on the organization row (gapless,
  but it serialises postings per organization).
- `prisma format` rewrites the WHOLE schema file (hundreds of lines of noise):
  don't run it; edit `schema.prisma` by hand.

## Stock voids (аннулирование) — fixing a phantom receipt + the write-off that removed it

Built for a real case: stock received that never physically existed, then written
off only to take it away again. `StockVoid` / `StockVoidLine` (migration
`20261001150000_stock_void`), `inventory/stock-void.service.ts`, Склад → «Аннулировать»
(OWNER/ADMIN only, `STOCK_VOID_ROLES`).

- **It moves nothing.** The selected receipt(s) and write-off(s) must net to ZERO at
  every location (stock is already right). A void is an append-only link; the
  `StockMovement` rows are never edited or deleted (they stay in the stock history,
  flagged `voided`). One movement can be in at most one void (unique `movementId`);
  there is deliberately NO undo — hiding a loss is a one-way, audited statement
  (`stockVoid.create`, with a reason of ≥ 5 characters).
- **What it removes from the figures:** `voidLine: null` is filtered out of the P&L
  inventory losses (`FinanceService.getProfitAndLoss`), the event projection
  (`accrual-events.ts`, so the ledger, balance CONTROL and reports never see them),
  the quality report/summary and the movement summary. Stock-level and consistency
  checks still count them (the pair nets to zero). If you add a NEW consumer of
  write-offs/receipts that reports losses, add `voidLine: null` to it.
- **Only manual movements qualify.** A receipt with a purchase order/invoice behind
  it (or production, delivery, sale, return, stocktake) is refused — that needs a
  supplier return, which is not built. Annulled/closed-month movements are refused;
  a CLOSED month is frozen, so the owner must reopen it first and re-close after.
- **With the general ledger on**, `postLedgerSources` after the void reverses any
  already-posted entry for those movements (they no longer project) and closes
  out a never-posted event as `NO_GL_EFFECT/SOURCE_CANCELLED`.

## Goods «под реализацию» (consignment) — an agent model, not a trade

Somebody else's goods (the village shop's) sold on our shelf. **They are in NO
revenue, cost, margin or sales-analytics figure** — the owner decided this
explicitly ("вообще не участвовали в отчётах, расчётах"), with the markup not
ours either: **everything collected is owed to the supplier** (a product is
consignment by `consignmentSupplierId` alone; `consignmentPrice` is retired).

- `Sale.consignmentAmount` / `SaleReturn.consignmentAmount` = the part of the
  total that is such goods (Σ `subtotal` of lines with a `consignmentSupplierId`,
  set once at creation; migration `20261002100000` backfilled history). Our
  figure is `totalAmount − consignmentAmount` — use `common/own-sales.ts`
  (`ownAmount`, `OWN_ITEMS`). Item-level loops skip `consignmentSupplierId` lines.
- **Money questions keep the full total** (till takings by method, customer
  receivable/credit, refunds paid out, cash/bank, ДДС): the cash really moved.
  **Revenue/cost/margin/analytics questions use own amounts** (P&L, sales
  report/summary/dynamics, profitability, customer trend, locations, HR revenue,
  ABC/XYZ, replenishment, promotions' average ticket, AI weekday anomalies).
  A basket made only of consignment goods is not one of our sales (not counted).
- Events (`accrual-events.ts`): the SALE event carries `RECEIVABLES +total` and
  `CONSIGNMENT_PAYABLES +consignment` (net P&L = own revenue only); no COGS or
  inventory event for those lines; a return reverses the payable, not revenue.
  The debt (`getConsignmentOwed`, `ConsignmentService`) is Σ line `subtotal` −
  returns − payments. The general ledger follows from the events automatically.
- Rolling this out on a ledger that is already ON: consignment sales posted
  before the change keep their old entries, and diagnostics show SOURCE_DRIFT
  (a WARNING) for them — reverse and repost those, never edit.

## Product classification — Type → Category → Subcategory → Product

Full write-up: `docs/PRODUCT-CLASSIFICATION.md`. The rules that are easy to break:

- `ProductType` is `RAW_MATERIAL | PACKAGING | FINISHED_GOOD | SEMI_FINISHED`. Packaging is a
  stock item only: never a recipe ingredient (recipes accept RAW only), not sold,
  `CostingService` untouched (purchase average else unknown). Don't invent
  packaging accounting or consumption without a fresh request.
- `Category.type` + `Category.parentId`: **two levels only**; a subcategory takes
  its parent's type; a typed category's type is immutable; a legacy category with
  `type = NULL` is open to any type until typed (and only if what it holds
  agrees). Top-level names are unique per organization (partial unique index),
  siblings unique per parent — so «Другое» can repeat under different parents.
  Don't restore the old `organizationId_name` unique lookup; use `findFirst`.
- Products may only sit in a category of their own type (`ProductsService
  .assertCategoryFits`); an unrelated edit never re-judges an existing category.
- **A filter on a category means it AND its subcategories** (`categoryIdsWith
  Descendants`, `CategoriesService.idsWithDescendants`); a coupon rule on a parent
  covers children, the child's own rule wins (`resolveCategoryRule`). Category
  names are shown as «Родитель › Подкатегория» (`common/category-label.ts`).
- `SaleItem.categoryIdSnapshot` is the category at sale time; the sales report
  uses it and falls back to the product's *current* category only where it is
  NULL (legacy sales — back-filled once by migration `20261004110000`, so today
  it is NULL only for products that had no category). Snapshot any new row that needs a
  history-stable category grouping before building a category report.
- The standard catalogue is offered via an OWNER/ADMIN button and only ADDS: the
  23 approved top-level categories, no subcategories, no «Другое» filler; matched to
  existing ones ignoring case and a trailing «…» (`normalizeCategoryName`).
- **Mass classification** (`apps/api/src/classification/`, Склад → Категории →
  «Классификация», OWNER/ADMIN): upload keyed by SKU → Preview (writes nothing) →
  Apply (one transaction, changes ONLY `categoryId`, creates categories/subcategories)
  → Audit (`classification.apply`/`revert`) → Rollback (per-line, conflicts reported).
  Consignment, prices, stock, sales and `CostingService` are never touched. Apply is
  run by the owner only, after migration `20261004110000` has frozen history (it stamps
  every legacy NULL `SaleItem.categoryIdSnapshot` with the product's then-current
  category; the promotions report reads the snapshot too). POS shows main categories only.
  Details: `docs/PRODUCT-CLASSIFICATION.md`.

## Semi-finished products (полуфабрикаты) — Stage 1 built

Full write-up: `docs/SEMI-FINISHED-DESIGN.md`. A recipe ingredient may now be `RAW_MATERIAL` **or**
`SEMI_FINISHED` (a component with its own recipe: cream, crumbs, dough). Rules that are easy to break:

- **One place** knows nested cost, expansion to raw materials and loop/depth checks:
  `apps/api/src/recipes/recipe-tree.ts`. Recipe card, `resolveProductUnitCosts` (hence `CostingService`,
  untouched) and `ProductionService.complete` all use it. Never add a flat per-item cost sum again.
- Producing the parent **expands** semi-finished lines into raw materials (stock check, consumption rows,
  cost) — the semi-finished product has no stock, `trackInventory` is forced false, it is never sold or
  bought and has no batch of its own. Stage 2 (stocked intermediates) is not built.
- A recipe's yield is stored to 0.001 of the unit; unknown cost (a part with no active recipe) is `null`,
  never zero (`costComplete: false` on the card).
- **Stage 2 is BUILT: a semi-finished product can be held as stock** (`trackInventory = true`, switched by the
  owner; default off). It gets its own batches (raw consumed by the PLAN, output = weighed ACTUAL), a moving
  weighted-average cost on `Product.averageUnitCost` (one price, all locations — never FIFO), and a parent
  recipe takes it from stock at that average instead of re-consuming raw materials
  (`isStockedSemiFinished` in `recipe-tree.ts`). `common/product-costs.ts` values it at the average, so
  `CostingService` is unchanged. The books were verified with the ledger on (`stocked-semi-finished.spec.ts`).
  `Recipe.uncountedNote` shows «Не учтено: …» until a semi-finished ingredient is in the recipe — never
  invent the amount of filling per pie; it is entered after it is measured.
- Packaging is still NOT a recipe ingredient (pending the owner's decision); no «Полуфабрикаты» category
  was created without his approval.

## Actual raw material in production + «Отклонения» (built)

«Завершить» shows the norm per ingredient (`GET /production/batches/:id/norm`: the recipe expanded to stocked items,
per ONE unit of what the batch consumes for — the output, or the plan for a stocked semi-finished product) with a «Факт»
field; only lines that differ are sent (`CompleteBatchDto.consumption`, absent = norm, so the Telegram bot and old
clients are unchanged). The product's cost stays the NORM (D1): consumption rows are the norm as before; above it a
`WRITE_OFF` with `WriteOffReason.PRODUCTION_OVERUSE` (migration `20261110130000`, system-only — `MANUAL_WRITE_OFF_REASONS`
is what pickers offer), below it an `ADJUSTMENT` (+) «Экономия сырья», both with `batchId` and the same cost stamp, posted
via `postLedgerSources` (inventory loss / gain; the PRODUCTION event stays raw → finished at the norm). The shelf loses
exactly the actual. Производство → «Отклонения» (`GET /production/batches/deviations`) reads it back from the batch's
movements: per ingredient and per batch, norm / fact / deviation / ₸, Excel. Производство → «Выпуск»
(`GET /production/batches/output`, `…/unit-cost-trend?productId&months`): completed batches per product × point —
quantity, ingredient cost (`ProductionBatchCost` INGREDIENT, i.e. the norm) and unit cost; a row opens that product's
unit cost by Almaty month (12, zero-filled, recharts line). The financiers' acceptance example (ТЗ §9.3) runs as
`finance/acceptance-example.spec.ts` (450 average → 225 a unit → receivable → paid → ОПиУ/ДДС/баланс agree, GL clean).

**Брутто / потери / нетто, версии техкарты, требование-накладная (ТЗ §4) — built** (migration
`20261115120000_recipe_versions_requisitions`, additive):
- `RecipeItem.quantity` is БРУТТО (stock and cost stay on it — no money change); `RecipeItem.lossPercent` (nullable)
  gives НЕТТО = брутто × (1 − %/100) (shared `recipeNetQuantity`), shown on the card, the form and the PDF only.
- `RecipeVersion` (append-only by trigger): the composition (yield, recipe loss, lines as JSON with names) written on
  create and on every save that changes yield / recipe loss / lines (a note edit is not a version). `validFrom` = the
  save moment — never a chosen past date (history is never recomputed); the migration wrote v1 of every recipe with
  `validFrom = updatedAt`. A completed batch gets `recipeVersionId` (the latest version at completion), shown as «по
  версии техкарты N». Batches keep their own cost stamps, so «old documents by their version» needed nothing else.
- «Требование-накладная» (Производство → «Требования», `production/requisitions.service.ts`,
  `/production/requisitions`, MATERIAL_REQUISITION_CREATE/POST_ROLES): склад → цех, план на дату; the need = each
  PLANNED/IN_PROGRESS task of that day at the workshop × the norm through `expandRecipe` (tracked items only), tasks can
  be unticked, lines edited/added. DRAFT (editable, deletable) → POSTED (trigger: never changed again): a TRANSFER_OUT /
  TRANSFER_IN pair per line with `StockMovement.materialRequisitionId`, same cost stamp on both legs (like a route
  delivery) — no money, events or ledger. Numbered per organization; audited `materialRequisition.*`. Printable.
- «Сверка выдачи с нормой выпуска» (card under Производство → «Требования», `GET /production/requisitions/issue-report
  ?locationId&from&to`, Almaty days): per raw material at one workshop — issued by requisitions (TRANSFER_IN of kind
  REQUISITION), the norm of completed batches (PRODUCTION_CONSUMPTION), the actual (norm + PRODUCTION_OVERUSE − savings),
  and «сверх нормы» = issued − norm in quantity and ₸ (stamped costs). Read-only; Excel/PDF.

## ТЗ remainder (04.11.2026) — dashboard, ДДС filters, ОПиУ by points, balance inventory split, transfers, act of output, PO fields

- **Дашборд** (ТЗ §8.4): `GET /dashboard/finance?locationId` (FINANCE_VIEW_ROLES, `dashboard/dashboard-finance.service.ts`) —
  выручка / валовая прибыль / маржа today, last 7 days, calendar month (each straight from `getProfitAndLoss`), money on
  accounts (with a point: its own accounts + its non-cash account), receivables/payables from the debts reports, own
  finished goods on STORE shelves at cost and at the point's price, top-5 of the month. Point filter on the page;
  `/dashboard/summary` takes `locationId` too. Other roles keep the revenue-only cards.
- **ДДС by point / account / direction** (ТЗ §6.3): `locationId` / `accountId` / `direction` on every `/finance/cash-flow*` endpoint.
  `events/cash-scope.ts` filters CASH LEGS: an account keeps only its legs (a transfer stays as its internal movement, so
  closing = the account's balance and it reconciles); a point keeps movements whose document (sale, return, expense,
  supplier order) is at that point, else whose account is tied to it — no reconciliation for a point (shared accounts).
  A scoped request is always live (the frozen snapshot is the network's).
  A direction keeps only movements whose document has one (`cashScopeIndex`: sale / its return by `businessDirectionOf`,
  an expense by its `direction`, a customer payment with no sale = wholesale, a correction follows what it corrects);
  common expenses, suppliers, transfers and opening balances have none — no reconciliation for a direction.
- **ОПиУ по точкам** (ТЗ §8.2): `GET /finance/pnl/locations` → one `getProfitAndLoss(…, locationId, { ownExpensesOnly })`
  per active point + the network total; whatever no point has (expenses with no point, depreciation, cost correction)
  is ONE column «Не отнесено к точкам», so the columns add up to «Итого» (spec). The ordinary single-point P&L still
  includes company-wide expenses (unchanged). Card `location-pnl-card.tsx` under the ladder when no point is filtered.
- **Баланс**: «Запасы» carries `breakdown` (сырьё на складе / незавершённое производство = сырьё в цехе, i.e. at a
  BAKERY_PRODUCTION point / готовая продукция) — `BalanceService.inventoryAt`, each product valued exactly as before and
  shared by where its quantity lies, so the total never changes (presentation only).
- **Склад → «Перемещение»** (ТЗ §3.3): the SAME document as the требование-накладная, `MaterialRequisition.kind = TRANSFER`
  (migration `20261116120000`, numbering per kind), `POST /inventory/transfers` (INVENTORY_MANAGE_ROLES) creates and posts
  at once (a failed post deletes the draft); finished goods allowed; reason «Перемещение №n»; audited `stockTransfer.*`.
- **Выпуск**: `CompleteBatchDto.outputLocationId` puts the output straight into another point (PRODUCTION_OUTPUT movement
  there, reason «… → точка»); everything else about the batch stays at its own point. «Акт выпуска»
  (`GET /production/batches/:id/document`, link on a completed batch): per ingredient norm / fact / stamped price / sum /
  deviation, batch cost (the norm, D1) and unit cost, «Прочее» = untracked ingredients; printable.
- **«Приход / заказ»** (Закупки, `new-purchase-order-modal.tsx`): the window opens on «Товар привезли» — the order is
  created and received in ONE step (`createOrder` then `receiveOrder` with no line changes, «Оплачено сразу» optional;
  a failed receipt keeps the created order and a retry only receives it); «Заказать на будущее» = the order alone,
  received later with «Принять». Same two documents as ever — no new data. The owner found order-then-receive clumsy
  for goods that simply arrive.
- **Заказ поставщику** (migration `20261117120000`): `supplierDocNumber` + `note` (at creation or receipt);
  `receive({ payNow: { accountId } })` = «Оплачено сразу»: checked first (SUPPLIER_PAYMENT_ROLES, cutover on, account),
  then the receipt, then `recordPayment` of the balance due (note «Оплачено при приёмке»).

## ТЗ audit follow-ups (04.11.2026) — small items closed after the strict audit

- **ОПиУ by article**: `ProfitAndLossDto.operatingExpenseLines` / `otherResultLines` (`{label, amount}` per finance article,
  «Без статьи» for none; disposals of fixed assets as their own line) shown as sub rows in `pnl-ladder.tsx`. The P&L
  «Excel» is ONE workbook: ОПиУ + По товарам + По точкам + По направлениям (the two cards hand their sheet up via `onSheet`).
- **Closing a month** = `PERIOD_CLOSE_ROLES` (OWNER/ADMIN/ACCOUNTANT); reopening stays OWNER only.
- **Second audit (05.11.2026), the ТЗ read word by word**: Отчёты → Рентабельность takes `directionId` (sales filtered by
  `directionIdOfSale`) and shows «Доля в выручке»; Склад → ОСВ shows «Средняя цена» at the end (value ÷ quantity);
  Производство → «Выпуск» carries the point's default direction (column + filter, «Без направления»); the dashboard takes
  `directionId` — revenue / gross profit / margin from `getPnlByDirection`, top-5 from the direction's own lines; money,
  debts and the shelf stay per point; a bank line posted as an expense takes `locationId` / `directionId`
  (`PostBankLineInput`). The guide lists what is still different from the ТЗ (no direction field on purchase orders /
  transfers / «Новая операция», no read-only owner role, reopening a month is OWNER only, surplus nets inside
  «Потери по запасам», prices to 2 decimals).
- **Balance**: «Денежные средства» broken down by account (`cashByAccountAt`), expense payables by article.
  Articles marked «Оплата труда» (`FinanceCategory.payroll`, migration `20261120120000`, checkbox in the article form) show
  their unpaid confirmed expenses as `BalanceLine.PAYROLL_PAYABLES` «Задолженность по оплате труда» — presentation only
  (events/ledger keep them inside EXPENSE_PAYABLES; CONTROL compares the sum), live date only.
- Отчёты → Рентабельность «По группам товаров» (top-level category of the sale-time snapshot); Склад → ОСВ group filter.
- Sale card shows cost / gross profit / margin / markup for FINANCE_VIEW_ROLES (`SaleItemDto.unitCost`, the line stamp).
- X/Z reports and «Смены»: card takings «в т.ч. Kaspi QR» (`Sale.terminalMethod === "qr"`, `till-takings.ts`).
- `WriteOffReason.TASTING` «Дегустация» (manual reason; migration `20261118120000`).
- «Сверка дня»: lines carry today's `unitCost` (own goods); the summary adds `shortageCost`/`surplusCost` beside the price
  figures — information only, the result stays at the price.
- Инвентаризация: «Excel»/«PDF» = инвентаризационная опись (by book / fact / difference / cost / sum), not in a blind count.
- **Purchase orders have our own number** (`PurchaseOrder.number`, unique per org, nullable only for rows written straight
  to the DB by specs; `ProcurementService.withNextNumber`; migration `20261118130000` numbered existing orders by
  `orderedAt`). `GET /procurement/orders/:id`. «Новый заказ поставщику» has a «Сумма» per line: typing it sets the price
  = sum ÷ quantity to the тиын (prices are stored to 2 decimals).
- **Checks have our own number** (`Sale.number`, unique per org; `Organization.saleSequence` incremented INSIDE the sale's
  transaction in `SalesService.create`, so the org row is locked until commit — two tills never share a number; migration
  `20261119130000` numbered existing sales by `soldAt` — sales have no `createdAt` column, a first draft of the migration
  failed on exactly that). Printed on the till receipt «Чек № N», `GET /sales?number=` (Продажи → «№ чека»; the till's
  «История» treats digits in its search as a check number on any day). Clean start resets the counter to 0.
- `FinanceCategory.code` (optional, ≤ 20 chars, «Статьи ДДС» shows it before the name; empty string clears it).
- Склад → «Движения»: `StockMovementDto.document` names the source (check, return → its check, purchase order / supplier
  return → the order, production → «Акт выпуска», requisition/transfer №, stocktake, «Сверка дня»); sale, order and batch
  open in place.

## «Начать учёт с чистого листа» (clean start) — built, the owner presses it himself

Owner's decision (04.11.2026): the first two months were invented (stock received from nothing, sales rung up without
production, no expenses/payroll), so every figure was a lie. Настройки → «Начать учёт с чистого листа» (OWNER only,
`NotDemoGuard`, `apps/api/src/clean-start/`, `components/clean-start-card.tsx`): preview (`GET /clean-start/preview`,
writes nothing) → `POST /clean-start {confirmation: "ОЧИСТИТЬ"}`, refused without a backup download
(`dataExport.download` audit row) in the last 24 h. ONE transaction (timeout 5 min): `clean-start-plan.ts` deletes every
transactional table of the organization children-first (sales, returns, stock movements/levels, stocktakes, production,
requisitions, purchases, invoices, cash movements, expenses, bank statements, till shifts, reconciliations, fixed assets,
periods/snapshots/cost corrections, journal, loyalty points entries, routes, HR shifts/time) and resets cached figures
(cash account balances → 0, `Product.averageUnitCost` → null, `financeInitializedAt`/opening values/`ledgerStartsAt`/
`journalEntrySequence`); then checks every removed table is empty or rolls back; audited `organization.cleanStart`.
KEPT: products, prices, photos, categories, recipes + versions + stages, locations, users/PINs, customers, suppliers,
loyalty members/consents/birthdays, finance categories, accounts, bank rules, promotions, CRM, planning, audit log.
**Every table with `organizationId` must be listed as removed or kept** — `clean-start.spec.ts` fails otherwise; a new
table needs a decision. Afterwards the opening stock goes in as Склад → «Приёмка» per point (raw materials first, WITH a
unit price — that sets the moving average and the card price; then finished goods at recipe cost), NOT as a stocktake: a
stocktake on zeroed stock books the whole shelf as a surplus = an inventory GAIN in the P&L, while a manual receipt is
balance-only (`INVENTORY_GAIN` event with no P&L leg). Then Финансы → «Запустить» freezes stock/debts as the opening position.
Verified on a full clone of the local database (cleared in ~130 ms, every page loads on the empty books).

## «Уход в минус» before the first stock count (built 05.11.2026)

For opening a new shop/workshop before anyone could count the stock. `Organization.allowNegativeStock` (migration
`20261122120000`, Склад → Остатки: «Разрешить уход в минус» / «Выключить», OWNER/ADMIN via `PUT /inventory/settings`,
audited `inventory.allowNegativeStock`): ONLY production consumption and till/«Новая продажа» skip the stock check
(`common/stock-guard.ts` `allowsNegativeStock` + `decrementStock`, which upserts a negative level); write-offs,
transfers, supplier returns etc. stay strict. Everything is written as usual (consumption at the norm and the current
cost). The first count is approved with «Начальные остатки» (`StocktakeService.approve(…, {opening: true})`, allowed only
while the switch is on): every difference — surplus AND shortage — becomes a signed RECEIPT «Начальный остаток
(инвентаризация)» (a shortage is the opening being smaller, not a loss of these days), `Stocktake.opening = true`,
skipped by the event projection, and — if Финансы → «Запустить» was already done — its value is ADDED to
`Organization.openingInventoryValue` (as if counted at the start); before the launch the launch values it from the
stock. A shortage stays an ordinary adjustment. Intended order: «Запустить» on the first morning (cash counted),
switch on, work, count with «Начальные остатки», switch off. Launching LATER is also fine (the owner waits for the bank
question): `BalanceService` adds the cash of every event dated before go-live to «Денежные средства» and to opening
equity, so the days traded before «Запустить» are part of the opening position (spec: «launching finance after…»).
Spec `inventory/negative-stock.spec.ts`.

## One price list for several shops + no raw materials at a point of sale (built 06.11.2026)

- **«Цены: как на точке …»** (Склад → «Цены по точкам», `Location.priceSourceLocationId`, migration
  `20261123120000_location_price_source`, `GET|PUT /products/location-prices/:locationId/source`, PRODUCT_MANAGE_ROLES,
  audited `location.priceSource`): a point linked to another STORE charges that point's `ProductLocationPrice` rows.
  EVERY read of point prices goes through `common/price-source.ts` (`priceListLocationId` / `priceListLocationMap`):
  catalogue `effectivePrice` (the till), `assertTillPrices`, coupon pricing, the dashboard shelf at sale price. The
  follower's own prices stay stored and come back on unlinking; editing them while linked is refused; no chains (a
  source cannot follow, a point followed by others cannot follow). A new reader of point prices must use the helper.
- Склад → Приёмка / Списание / Корректировка at a STORE point hide raw materials from the product picker unless that
  point already has some on its books (UI only — the server still accepts them, e.g. the Telegram bot).

## «Корректировка остатка» of a cash/bank account (built)

Финансы → Банк и касса → «Корректировка остатка» on each active account (`CASH_ADJUSTMENT_ROLES` = OWNER/ADMIN/ACCOUNTANT,
`components/cash-adjustment-modal.tsx`): type the counted balance → ONE `ADJUSTMENT` movement dated now for the difference
(`CashMovementsService.adjust`, row locked, nothing earlier changed, audited `cashAccount.adjust`). The difference needs a
fully classified article of the right kind; for a SHORTAGE `ownerWithdrawal: true` books it to «Изъятие собственника»
(found by name, else created EXPENSE / NOT_IN_PNL / FINANCING / OWNER_WITHDRAWAL — the bank import's preset), so years of
unrecorded выемки do not become a loss in the P&L. Built after a till's books showed 4.3 M ₸ that was not in the drawer.

## Phone layout + product photos (built)

- **Below `lg` (1024 px) the menu is a drawer**: `Sidebar({open, onClose})` slides over the page, opened by the topbar's
  «Меню» button (`Topbar({onMenu})`), closed on navigation; ≥ lg nothing changed. `main` padding is `px-4 sm:px-6 lg:px-8`.
- Pages were NOT rewritten one by one: a block at the end of `globals.css` (`@media (max-width: 1023px)`, scoped to
  `main`) makes any table's parent scroll sideways (`:has(> table)`), and lets rows of buttons / selects / inputs, tab
  bars (`.flex.bg-surface-muted.p-1`) and `justify-between` rows wrap. A new page gets this for free; check it at 390 px
  (`document.querySelector("main").scrollWidth` should equal the width).
- Till on a phone: the check sits under the product grid; a bottom bar «Чек · N поз. · сумма» jumps to it and hides
  while the check is on screen.
- **Product photo** (finished goods, «Фото для кассы» in the product form): resized IN THE BROWSER to ≤ 480 px JPEG
  (`lib/product-photo.ts`), stored in the DB (`ProductPhoto`, base64, one per product, cascade with the product; migration
  `20261119120000`) — there is no file storage. `PUT/DELETE /products/:id/photo` (PRODUCT_MANAGE_ROLES, audited
  `product.photo[Remove]`, ≤ 400 KB; JSON body limit raised to 1 MB in `main.ts`). The picture is served WITHOUT a login by
  `ProductPhotoController` `GET /products/:id/photo?v=<photoVersion>` (an <img> cannot send a token; immutable cache, a new
  photo = a new `v`). `ProductDto.photoVersion` (ms of the last change, null = none). POS tiles show it only when present.

## Baker's calculator (расчёт техкарты на количество) — built

Производство → a calculator icon on every active recipe card and on every task row (task opens at its
plan/fact). `GET /recipes/:id/breakdown` (open to every role, like the list) returns the recipe laid out
for its own yield through `expandRecipe` — virtual fillings become raw materials in ONE list, a STOCKED
semi-finished stays one line «со склада», exactly what production consumes. All scaling is pure shared
maths (`packages/shared/src/recipe-scale.ts`): by quantity, or by weight of a base (default «Вся мука» /
the one flour / the heaviest ingredient), baker's % against that base, split into equal mixes by
`Recipe.mixCapacityKg` (migration `20261018120000`, «Вместимость замеса, кг» in the recipe form; the owner
uses 20 kg for bread, 10 kg for cakes/pies; editable per calculation). Pieces and stocked fillings are
not in the mix mass. Print = a plain HTML window. No money is shown on it. Hiding cost/margin from
production staff elsewhere was discussed but NOT built (the one laptop user is also the accountant).

## «Сверка дня» (till + shelf against the ledgers) — built

Продажи → «Сверка дня» (`/sales/reconciliation`, `RECONCILIATION_ROLES`: OWNER/ADMIN/REGIONAL_MANAGER/
STORE_MANAGER/ACCOUNTANT/OPERATOR — cashiers deliberately excluded, they count blind). One location, one Almaty
business day: per product opening (all movements before the day) + received − sold + returned + other = closing
by the system, vs the count typed in; money per tender: cash expected = размен + cash sales − cash refunds + the
till's other movements that day (paid-out expenses, withdrawals… — SALE_RECEIPT/SALE_REFUND/OPENING_BALANCE
skipped, taken from sales/returns), card/transfer = sales − refunds. Result = money difference + goods
difference at the product's price: goods missing with the same money extra nets to 0 (sold without ringing up),
missing goods with no extra money is a loss. Pure maths shared (`packages/shared/src/reconciliation.ts`), so the
screen recalculates as typed. `apps/api/src/reconciliation/`, migration `20261023120000` (two additive tables).
**It moves nothing** — saving stores only the counts and the summary as it stood (history); the expected side is
always recomputed. One worksheet per location+day, saving again replaces it (audited `dailyReconciliation.save`).
The till and the shelf are one unit (3 cashiers share one till at Мерей), so there is no per-cashier split.

**«Применить к остаткам» + «Печать бланка»** (migration `20261028150000`): applying a SAVED worksheet writes, once, each
counted line's DIFFERENCE (counted − the day's closing) as an ADJUSTMENT with `StockMovement.dailyReconciliationId`
(reason «Сверка дня ДД.ММ.ГГГГ») — a difference, never "set to the count", so sales after the evening count are not
undone; uncounted lines untouched; `appliedAt` flipped conditionally (no double apply); the counts are locked after it
(money stays editable); `INVENTORY_MANAGE_ROLES` (same as «Корректировка»). The worksheet's own adjustments are left out
of its own day, so it keeps showing the shortage it found. Lines are in shelf order (category «Родитель › Под», then
name, consignment last) — the printed count sheet (no expected column: blind count) and the screen read the same way,
and Enter in a count jumps to the next one.

**A cashier's price is the server's** (`SalesService.assertTillPrices`): a CASHIER line must be the point's price or its
fixed markdown (`markdownPrice`, with `fullUnitPrice` = point price) — the only things the till sends; anything else is
refused. **«Произвольная сумма» is switched off at the till** (owner's decision, for «Сверка дня»: an amount with no
product cannot be checked against the shelf) — the POS no longer offers it and a CASHIER line on the `isOpenPrice`
product is refused; the product row itself stays (history, and other roles' sales on «Продажи») (a 0 ₸ check with the cash pocketed balances perfectly in «Сверка
дня»). Coupons/points are applied by the server after this. Other roles keep a free price (wholesale on «Продажи»).
The till's «История» loads the whole Almaty day (not the latest 50) and filters by product (`GET /sales?productId=`).

**The operator does not see the takings as totals** (owner's decision): `REVENUE_VIEW_ROLES` = every role but OPERATOR
gates `/sales/summary|report|profitability|dynamics|demand`, `/dashboard/summary`, the map's revenue and the staff bot's
sales figures/«Средние продажи». The web hides Дашборд/Отчёты (`NavItem.roles`, `isBlockedRoute`/`homeFor` in `lib/nav.ts`
— an operator lands on /sales) and the cards on Продажи. The list of checks, «Новая продажа», the till and its history stay.

**Several products in one stock document** — Склад → Приёмка / Списание / Корректировка take many lines
(`InventoryService.applyBatch`, `POST /inventory/{receipts|write-offs|adjustments}/batch`, max 100 lines,
`STOCK_BATCH_MAX_LINES`). One transaction: one line short of stock stops the whole document and names the product;
a product twice is refused; an adjustment line that already matches is skipped and reported. An empty quantity is
never read as 0 (that would empty the shelf on a correction). The single-product endpoints are unchanged — the
Telegram bot still uses them.

## Кассовая смена (till shift, ТЗ §5.4) — built

The till's «Смена» button (`components/till-shift-control.tsx`): open with the cash counted in the drawer → «Внесение» /
«Выемка» with a comment → «X-отчёт» any time → «Закрыть смену» with the cash counted → Z-отчёт (printable via
`printSheets`). Продажи → «Смены» (`/sales/shifts`, `TILL_SHIFT_HISTORY_ROLES` = RECONCILIATION_ROLES): every shift with
расчёт / посчитано / расхождение, Excel/PDF, and the switch «Продажа на кассе только в открытой смене»
(`Organization.tillShiftsRequired`, default OFF, OWNER/ADMIN; when on, a CASHIER's sale without an open shift at that point
is refused — `till-shifts/till-shift-guard.ts`, called in `SalesService.create`). `apps/api/src/till-shifts/`, shared
`till-shifts.ts`, migration `20261112120000_till_shifts` (additive table; one open shift per point by partial unique
index; a closed shift cannot be updated — trigger).
- **A shift owns nothing**: it is a time window over the point's own documents. Figures = `reconciliation/till-takings.ts`
  (`tillTakings`, the SAME tender rule «Сверка дня» uses — extracted from it) + the point's CASH accounts' other movements
  in the window. Expected cash = opening count + cash sales − cash refunds + those movements.
- **Внесение / выемка = an ordinary transfer** between the drawer (the point's CASH account, default first) and another own
  account chosen by the cashier (`CashMovementsService.transfer`, reason «Выемка (смена №n): …») — no new accounting rule.
- **Blind count for the till's own staff** (owner's decision, 04.11.2026 — a cashier saw «По учёту в кассе: 4 357 195»):
  for `TILL_ROLES` (cashier, senior cashier) the SERVER withholds the drawer's book balance, «Должно быть в кассе», the
  cash takings/refunds, total revenue (it would give the cash back), the CASH tender row, `bookCashAtOpen` and the
  difference (`blindShift`/`blindReport` in `till-shifts.service.ts`, `TillShiftReportDto.blind`). They see checks,
  card/transfer/Kaspi QR, the opening count they typed and their own внесения/выемки, and close by typing the count.
  Managers see everything in Продажи → «Смены» (stored figures are unchanged).
- Closing stores the Z-report JSON, expected, counted and the difference; **it moves nothing** (an adjustment of stock or
  cash stays «Сверка дня»'s / Банк и касса's job). Audited `tillShift.open/close/setRequired`.
- **PIN + «Старший кассир»** (migration `20261113120000`, `auth/till-pin.ts`): `Role.SENIOR_CASHIER` (till like a
  cashier — `TILL_ROLES` = CASHIER + SENIOR_CASHIER are kept on /pos and priced by the point; in SALE_CREATE_ROLES,
  CASH_REGISTER_MANAGE_ROLES and SALE_RETURN_ROLES). `TILL_APPROVER_ROLES` = OWNER/ADMIN/STORE_MANAGER/SENIOR_CASHIER.
  - PIN = 4–6 digits set by OWNER/ADMIN in the employee card (`PUT /users/:id/pin`, audited `user.pin`); stored ONLY as
    `User.pinDigest` = HMAC(JWT_SECRET, org:pin), unique per organization (so the PIN alone identifies the person),
    redacted from backups. 5 wrong PINs in 5 min per device user → 5-min lock (in memory).
  - «Сменить кассира» on the till (`POST /auth/pin-login`, needs a signed-in device; same point or org-wide) → a normal
    login token for that employee.
  - Approval: `POST /auth/till-approval {pin, action}` → a 10-min JWT signed with a DIFFERENT key (`…:till-approval`), so it
    can never be used as a login; bound to the action, the asking cashier and the org (`resolveTillApproval`). An approver
    role approves itself.
  - **Скидка на чек** (`CreateSaleDto.manualDiscount {percent|amount}` + `approvalToken`): spread over own goods at their
    normal price by the SAME `distributePointsDiscount` as points (till previews identically) as a lower unit price with
    `fullUnitPrice` = list price → the P&L/events DISCOUNTS line, returns and fiscal need no special case;
    `SaleItem.manualDiscount` marks the lines so markdown figures skip them; `Sale.manualDiscountAmount` +
    `discountApprovedByName`; audited `sale.manualDiscount`. Not combinable with a coupon or points.
  - Возврат: a CASHIER may return only with an approval (`SALE_RETURN_WITH_APPROVAL_ROLES` on the route, check in
    `SaleReturnsService.create`); `SaleReturn.approvedByName`. The till's «История» → a check → «Возврат» asks the PIN.
  - Удаление позиции / уменьшение количества: only with the switch `Organization.tillLineRemovalApproval` (default OFF,
    Продажи → Смены) — then a cashier needs the senior's PIN, logged as `till.lineRemoval` (the cart is client-side, so the
    approval log IS the record).

## Debts — дебиторка/кредиторка by document, акт сверки (built, ТЗ stage 1)

From the financiers' ТЗ (iiko-style). `apps/api/src/debts/` (read-only service), shared pure maths in
`packages/shared/src/debts.ts`, migration `20261102120000_debts` (additive: `Customer/Supplier.bin` + `paymentTermDays`,
`Sale.paymentDueAt`, `Organization.legalName` + `bin`). Финансы → «Дебиторская/Кредиторская задолженность» = `DebtsReport`.
- **Nothing is stored about debts**: open items come from the same documents the balances do — sale total − `amountPaid`;
  received purchase orders after the cutover − payments not reversed; CONFIRMED invoices and expenses − `amountPaid`;
  consignment takings per Almaty day settled oldest first by returns + payouts (`settleOldestFirst`). On a past date
  («На дату»), cash movements after that day are put back. Today's totals equal `getAccountsReceivable` /
  `getAccountsPayable` (a spec asserts it) — the old payables tab missed orders and consignment; this one does not.
- Due date = the sale's own `paymentDueAt` (set at creation: stated in «Новая продажа», else today + the customer's
  deferral) or document date + the counterparty's current `paymentTermDays` (none = due that day). Age buckets are
  days since the document (0–1, 2–7, 8–30, 30+, as the ТЗ lists them); overdue days are past the due date.
- Card / акт сверки (`GET /debts/statement`): our side, debit = raises what they owe us. Customer: sale debit, payments
  credit (a paid-at-sale amount with no cash movement counts on the sale day), a return credit + its refund debit.
  Supplier: delivery/invoice/consignment day credit, payments and consignment returns debit, reversal credit.
  Balance > 0 = they owe us. The act prints from the browser (PDF via «Сохранить как PDF»), Excel alongside (see «Excel exports»). Organization requisites for its header: Настройки → «Реквизиты организации» (OWNER/ADMIN).
- Overdue receivables: a live notification per customer (`OVERDUE_RECEIVABLE`, critical after 30 days) and two cards on
  the dashboard for `DEBT_VIEW_ROLES`. `/finance?tab=…` opens a tab directly.
- **A return against a sale on credit cancels the debt first** (migration `20261110120000`, `SaleReturn.creditedAmount`
  + running `Sale.creditedAmount`; shared `splitSaleReturn`): the unpaid part of the sale is credited (no money moves),
  only the rest is refunded as SALE_REFUND movements. Owed = `totalAmount − amountPaid − creditedAmount` EVERYWHERE
  (sale DTO, payment guard, customer card/list, `getAccountsReceivable`, debts report incl. «На дату», акт сверки —
  «Возврат денег» shows only the money part, «Сверка дня» refunds, AI-центр). Events/ledger needed no change: the
  return event already lowers RECEIVABLES by the goods' value and only a refund raises it back. A fiscal return with a
  credited part is refused (a return receipt says money went back). Retail (paid in full) behaves exactly as before.
- **Авансы (advances) — built.** Supplier: a PLACED order can be paid ahead (`recordPayment`, only with the purchasing
  cutover on, up to the ordered total; Закупки → «аванс» on the row) — the receipt then settles by itself (owed =
  received − paid; a short delivery leaves `PurchaseOrderDto.advance` = overpaid). A PLACED order with an active payment
  cannot be cancelled (reverse the payment first). Customer: «Принять оплату» on the customer card
  (`POST /sales/customer-payments`, PAYMENT_RECORD_ROLES, audited `customer.payment`) pays unpaid sales oldest first;
  the rest is a CUSTOMER_PAYMENT movement with NO `saleId` = an advance, counted toward the customer's next credit sale
  automatically in `SalesService.create` (`sales/customer-advances.ts`, customer row `FOR UPDATE`; append-only
  `CustomerAdvanceApplication`, migration `20261110140000`; raises `Sale.amountPaid`, moves no money). Events/ledger are
  unchanged: advances live NET inside RECEIVABLES / SUPPLIER_PAYABLES; the balance sheet shows them GROSS from today's
  documents as presentation-only `BalanceLine.ADVANCES_PAID` / `ADVANCES_RECEIVED` (`FinanceService.getAdvances`), and the
  CONTROL and AP/AR diagnostics compare net (docs − advances). Debts reports carry `advances` (receivables report:
  supplier advances; payables report: customer advances, «на дату» too); акт сверки shows «Аванс…» lines once (an
  application is not a second payment). Not built: refunding a customer's advance in money, advances in the bank import.
- Supplier returns ARE built (see below).

## Справочники через Excel (built, ТЗ §2)

Номенклатура (Склад → Номенклатура), Клиенты (оптовые), Поставщики (Закупки) each have an «Excel» button
(`components/reference-excel.tsx`): «Скачать шаблон», «Выгрузить справочник», «Загрузить файл» → preview → «Применить».
`apps/api/src/reference-data/` (`GET /reference-data/:kind/export`, `POST …/preview` writes nothing, `POST …/apply`),
shared `reference-import.ts` (columns, header finding, number/yes-no parsing). Roles = whoever may create entries of
that directory by hand (PRODUCT/CUSTOMER/SUPPLIER_MANAGE_ROLES), checked in the service. The browser sends the sheet as
cells; the server finds the header row (first 15 rows, needs «Наименование»), plans every row against the database and
on apply goes row by row through `ProductsService`/`CustomersService`/`SuppliersService` create/update, so every rule of
the form applies; a refused row is reported, the others go in; audited `referenceImport.apply` (counts).
- Match: product by Артикул, else by name (several → error); counterparty by БИН/ИИН, else by name. A new SKU whose name
  already exists with another SKU is refused (no silent duplicates). **A blank cell leaves the value unchanged** — the
  import never clears a field. Categories are found, never created (that is «Классификация»).
- Excel stores digits as numbers: an 11-digit БИН gets its leading 0 back, a phone 7XXXXXXXXXX gets its «+».
- Export → load back = all «Без изменений» (spec asserts it).
- The small directories (Точки on Сеть точек, Счета on Банк и касса, Статьи ДДС, Сотрудники on Настройки) are export
  only (`components/directory-export.tsx`, from the already loaded list): a handful of rows each, typed by hand. PIN
  column says only whether one is set.

## Excel exports, ДДС by month, markup (built, ТЗ stage 2)

- **Every «Excel» button writes a real .xlsx** (numbers are numbers, bold frozen header, widths, title lines). One call:
  `downloadTable(filename, headers, rows, {sheetName, titleLines})` in `apps/web/src/lib/export-table.ts` — same shape the
  old `downloadCsv` had, which stays only as the fallback if the writer chunk fails to load. The writer is `lib/xlsx.ts`:
  an .xlsx is a zip of XML, written by hand with `fflate` (no SheetJS/exceljs — old advisories, heavy bundle), imported
  lazily on click. Strings that look like numbers («1234.50», «12») become numbers; `007`, a БИН (12 digits), phones, «—» stay
  text. Pass `{v, fmt: "percent"|"money"|"int", bold}` for a typed cell. Verified by opening the files in LibreOffice.
- **ДДС by month** (Отчёты → ДДС → «По месяцам», `GET /finance/cash-flow/monthly?fromMonth&toMonth` as `YYYY-MM`, ≤ 24
  months, no future month): `events/cash-flow-monthly.ts` runs the ordinary period statement (`buildCashFlowFromEvents`)
  once per Almaty calendar month and joins the lines by article, so it is the period report's own figures, not a second way
  of counting. Months split at Almaty midnight (`common/month-ranges.ts`); the current month stops at now. A month's opening
  is everything before it, so it equals the previous closing EXCEPT where an account's opening balance is dated inside the
  month — shown as its own row («в т.ч. начальные остатки счетов…»), never as an inflow. Click a cell → the movements behind
  it (`GET /finance/cash-flow/operations`, ≤ 500, newest first). Live from events, not the frozen snapshot: writes into a
  closed month are refused, so they cannot differ.
- **Наценка %** = gross profit / cost (`markupPercent`, null when cost is zero or unknown), next to Маржа/Маржинальность in
  Финансы → P&L by product, Отчёты (P&L, Рентабельность), the product P&L card and the техкарта card.
- **ДДС by weeks / days** (same grid, switch «Месяцы / Недели / Дни», Отчёты → ДДС → «По периодам»):
  `GET /finance/cash-flow/by-date?granularity=week|day&fromDate&toDate` (YYYY-MM-DD; ≤ 62 days / 53 weeks) and
  `…/operations-by-date`; `common/day-ranges.ts` (Almaty days; weeks Mon–Sun cut to the asked range, key = first day
  inside it). Same `buildCashFlowMonthly`, so days chain closing → opening and add up to the period statement (spec).
- **PDF of every report**: a «PDF» button beside each «Excel» runs the SAME export function inside
  `withExportTarget("pdf", …)` (`lib/export-table.ts`); `downloadTable`/`downloadWorkbook` then hand the table to
  `lib/print-table.ts` (a clean A4 page, landscape when > 6 columns, printed date) and the browser's print dialog
  («Сохранить как PDF»). The window must open inside the click, so print-table is loaded statically and stays small
  (`lib/coerce-number.ts` split out of xlsx.ts so fflate is not pulled in). The export function must call
  `downloadTable` synchronously (no await before it). A new report with «Excel» gets PDF by adding the second button.
  Баланс has Excel/PDF too.

## Correcting a received purchase order + document history (built)

From the financiers' answer: a posted document is corrected INSIDE the document, with «кто, когда, что было/стало».
Закупки → click the supplier on an order row → the order as a document (lines ordered/received, «Исправить приёмку»,
«История изменений»). `ProcurementService.revise()` (`POST /procurement/orders/:id/revise`, `PURCHASE_ORDER_REVISE_ROLES`
= OWNER/ADMIN/ACCOUNTANT) and `history()` (`GET …/:id/history`, open like the list). Migration `20261103120000`
(two additive append-only tables, UPDATE rejected by trigger).
- Nothing already written is rewritten: the order's lines/`receivedTotal` carry the current values; a
  `PurchaseOrderRevision` (+ lines) keeps before/after, actor, reason (≥ 5 chars); the stock difference is a NEW
  `RECEIPT` movement on the order with a SIGNED quantity (negative = taken back; RECEIPT's sign is +1, so the stock
  ledger stays consistent); the supplier debt follows by itself (received total − payments).
- Money in the books: `purchase-events.ts` keeps the receipt event at the ORIGINAL total (current − Σ revision
  deltas) and adds one event per revision (`purchaseOrder:{id}:revision:{n}`) for the difference, dated at the
  receipt — so an entry already posted in the general ledger never drifts; the correction posts beside it.
- Raw-material average: `revisePurchaseAverage()` takes the old line out at what it was booked at and puts the
  corrected one in (stock × average stays equal to the book value). If part was already used, its stamped cost stays
  and the remainder absorbs the difference until a month-end cost correction (not built yet, waits for the financiers).
  No stock left / value would go negative → average untouched. The card price follows only if this order is the
  product's latest priced receipt.
- Refused: receipt month closed (`PeriodGuard`), corrected total below what is paid, taking back goods no longer on
  the shelf, anything not RECEIVED. Till checks/sales are never edited (a return is the correction there).
- Not built: adding/removing lines, changing supplier/location, correcting manual Склад → Приёмка (use Корректировка).

## «Возврат поставщику» (supplier return) — built

Goods of a RECEIVED purchase order handed back to the supplier (the goods physically go back). Order document →
«Возврат поставщику» (`SUPPLIER_RETURN_ROLES` = OWNER/ADMIN/ACCOUNTANT), `ProcurementService.returnToSupplier`,
`POST /procurement/orders/:id/supplier-return`. Migration `20261105120000` (`SupplierReturn` + lines, append-only by
trigger; `StockMovementType.SUPPLIER_RETURN`, stock sign −1; `supplierReturnId` on stock and cash movements).
- The order is never edited. Goods leave at the line's RECEIVED price (movement stamped with it, no `purchaseOrderId`),
  the raw-material average gives that price back (`revisePurchaseAverage` before the stock leaves), at most what is left of
  the line, only if still on the shelf.
- Money: ONE formula, `procurement/purchase-owed.ts` `purchaseOrderOwed` = received − credited − paid + refunded, used by
  the order card, the payment guard, `getPurchaseOrderPayables` and debts. If the return credits more than is still owed,
  the supplier gives the difference back (`refundedAmount`) to a chosen account: an ADJUSTMENT cash movement with
  `supplierReturnId`. An order received before the cutover has no debt: goods leave, no money is recorded.
- Events: `purchaseOrder:{id}:return:{returnId}` (type SUPPLIER_RETURN, sourceType PurchaseOrder, so the order's posting
  scope posts it): INVENTORY −credited, SUPPLIER_PAYABLES −credited (legacy: inventory only, unclassified). The refund is
  its own cash event («Возврат денег от поставщика»: cash +, payable +). Descriptions carry «(№n)» — the diagnostics treat
  two entries with the same reference+description as a duplicate posting.
- Cost walk (`cost-history.ts`): a PURCHASE flow with NEGATIVE quantity at the stamped price (replay keeps the average if
  the value would go negative); ОСВ shows it as расход. `product-costs` subtracts returned quantities.
- Акт сверки: «Возврат товара поставщику» (debit) and «Возврат денег от поставщика» (credit).
- After a return, «Исправить приёмку» is refused for that order (the two would contradict each other).
- Not built: a return of goods from a manual Склад → Приёмка or from a supplier invoice (накладная).

## Прибыль по направлениям (опт / розница / заказы) — built

Финансы → «Прибыли и убытки» → table «Прибыль по направлениям» (`DirectionPnlCard`, `GET /finance/pnl/directions`,
same roles/period/location as the P&L). `finance/direction-pnl.ts`; shared `packages/shared/src/directions.ts`.
- **Directions are a directory** (ТЗ §2, migration `20261121120000_directions`, `Direction`, `apps/api/src/directions/`,
  Сеть точек → «Направления», `DIRECTION_MANAGE_ROLES` = OWNER/ADMIN/ACCOUNTANT, delete = HARD_DELETE_ROLES, audited
  `direction.*`). Three SYSTEM rows per organization (`systemKey` WHOLESALE/RETAIL/ORDERS, created lazily by
  `ensureSystemDirections`; renamable, never archived/deleted) keep the automatic rules; hand-made ones (name +
  optional responsible) get sales through a point's `Location.defaultDirectionId` and expenses through
  `Expense.directionId`. Archive refused while a point uses it as default; delete only if unused. Everything keys by
  direction **id** (P&L columns, allocation shares — legacy WHOLESALE/RETAIL/ORDERS keys are mapped on read, ДДС
  `direction` filter). The legacy `Expense.direction` enum column stays, back-filled into `directionId`.
- A sale's direction is read from the sale itself (`directionIdOfSale`): `Sale.crmOrderId` set → «Заказы»;
  `customerId` → «Опт»; else the point's default direction; else «Розница». A return follows its sale. Nothing about
  a sale's direction is stored (changing a point's default re-groups its past sales too — it is a management view).
- `Sale.crmOrderId` (migration `20261106120000`, nullable, SET NULL): the till's «Оплата заказа» (`PosOrderBlock`,
  `GET /sales/open-orders`, SALE_CREATE_ROLES — a cashier cannot reach `/crm`) attaches a prepayment or the rest to an
  open cake order; a CANCELLED order is refused. «Исправить чек» carries it over. Sales before this have no order, so
  «Заказы» starts from now — nothing is back-filled.
- Revenue and cost of goods are each direction's own, read like the P&L (own goods only, line stamp, today's cost
  only without one); a month-end cost correction moves a product's COGS by each direction's share of that product
  sold. **Common costs (inventory losses, operating expenses, depreciation, other result, recorded tax) are allocated
  by share of net revenue — the owner's decision (03.11.2026).** Totals ARE the period's P&L; parts are made to add up
  to the тиын (`allocate`, remainder on the largest). Net revenue ≤ 0 → nothing allocated (`allocated: false`).
- **Allocation base is a choice** (ТЗ §8.2, migration `20261111120000`, `Organization.directionAllocationBase` +
  `directionAllocationShares`, `PUT /finance/pnl/directions/allocation`, `DIRECTION_ALLOCATION_ROLES` = OWNER/ADMIN/ACCOUNTANT,
  audited `directionAllocation.update`): REVENUE (default = the owner's decision above), GROSS_PROFIT, or MANUAL %
  (sum 100, shared `directionSharesError`). The table shows «Прибыль до распределения» (gross profit − the direction's
  own expenses/other result), «Распределённые общие расходы» and «Прибыль после распределения (чистая)», plus EBITDA;
  Excel alongside. A management view only — nothing in the books depends on it.
- **EBITDA** = operating profit + depreciation (`ebitdaOf`, derived on the client so frozen snapshots show it too); the
  P&L ladder shows EBITDA → Амортизация → «Операционная прибыль (EBIT)» and «Рентабельность по чистой прибыли»
  (`netMarginPercent`). Финансы → P&L «Excel» is a workbook: «ОПиУ» (the ladder) + «По товарам» (`downloadWorkbook`).
- **Direct expenses** (migration `20261107120000`; now `Expense.directionId`, see the directory above): «Направление»
  in «Новый расход» (empty = common). A confirmed expense with a direction goes wholly to it — operating ones into its
  «Операционные расходы» (`directExpenses` shown as «в т.ч. прямые»), other/financial ones into its other result —
  and only the REST is shared by revenue. A management dimension only: never in events, the ledger or the P&L total.

## Загрузка банковской выписки (bank statement import) — built

Финансы → «Выписки» (`BankStatementsTab`, `BANK_IMPORT_ROLES` = OWNER/ADMIN/ACCOUNTANT), `apps/api/src/bank/`, shared
`bank.ts` + `bank-parse.ts`, migration `20261108120000` (`BankStatement`, `BankStatementLine`, `BankRule`). The owner's
bank is Kaspi Pay (ИП); all money is to land there. The .xlsx is read IN THE BROWSER (`lib/xlsx-read.ts`, fflate +
DOMParser) and parsed by shared `parseBankStatementRows` (Kaspi «Выписка»: header labels, then a table with «Дата
операции / Дебет / Кредит / Наименование… / ИИК / КНП / Назначение»; times are Almaty +05:00; «ИИН/БИН 12 digits» split
out of the name). Verified on the owner's real October file: 181 lines, opening + Σ = closing to the тиын. The real file
is NOT in the repo (personal data) — specs use invented lines.
- A line is stored once per account (unique `docNumber`); a re-upload skips known lines. A statement with nothing
  posted can be deleted.
- Suggestions: a remembered `BankRule` (by counterparty БИН, or — for Kaspi's own BINs 971240001315/200840000951, which
  carry takings, fees AND QR purchases from any shop — by the purpose with digits stripped, `purposeKey`) → built-ins
  («Продажи с Kaspi.kz» = SALES_SETTLEMENT; КНП 841/851 = «Комиссия банка»; КНП 342 «Перевод собственных средств» =
  «Изъятие собственника») → a supplier by БИН. Preset categories are created classified on first use.
- Posting (per line, own transaction, dated by the BANK — `recordMovement` got `occurredAt`; refused in a closed
  month except settlement/ignore, which write nothing): SALES_SETTLEMENT writes NOTHING (the till already recorded
  the card/Kaspi sale into the default bank account) and is compared per Almaty day with SALE_RECEIPT − SALE_REFUND
  movements of that account; CATEGORY = an Expense (CONFIRMED, paid) or, for OWNER_WITHDRAWAL/LOAN_REPAYMENT categories,
  a CASH_WITHDRAWAL with the category, or for income a CASH_DEPOSIT; TRANSFER = a transfer pair with another own
  account (deposit); SUPPLIER_PAYMENT = `ProcurementService.paySupplierOrders` (received orders oldest first, refused
  above the debt); IGNORE. The browser posts in chunks of 20. The statement view shows the system balance of the
  account at the period end against the bank's closing balance.
- **A point's own account for card money** (migration `20261109120000`, `Location.nonCashAccountId`, Финансы → Банк и
  касса → «Безналичная оплата на точках», `PUT /finance/accounts/non-cash/:locationId`, CASH_ACCOUNT_MANAGE_ROLES,
  audited `cashAccount.locationNonCash`): `common/non-cash-account.ts` `nonCashAccountFor` — the point's active BANK
  account, else the default bank. Used by sales; a refund goes back out of the account the sale's money came into (its
  SALE_RECEIPT movement), else the point's current one. One shop's card money goes to BCC (an ИП account), the rest to
  Kaspi Pay. Settlement comparison is per account, so it only matches once each point is bound right.
- **Банк ЦентрКредит (BCC)** sends «Обороты по счетам» as an OLD binary Excel (.xls, BIFF8). `lib/xlsx-read.ts` sees the
  OLE signature and hands it to shared `readXlsFirstSheet` (`xls-read.ts`, hand-written, no library). The parser takes
  BCC's layout too: bilingual headers («Күні / Дата»), «Label: value» in one cell, period «Движения по счету за … по …»,
  «Исходящее сальдо» AFTER the table, БИН from «БИН отправителя» (credit) / «БИН получателя» (debit). BCC pays a day's
  card/QR takings the NEXT morning («Возмещение коммерсанту / НПК QR: у-во …», BCC's BIN 980640000093 is an aggregator)
  → SALES_SETTLEMENT compared with the PREVIOUS Almaty day. Verified on the owner's October file: 25 lines,
  opening + Σ = closing. Spec fixture `apps/api/test/fixtures/bcc-statement-invented.xls` is invented (xlwt).
- **Any bank by a column mapping** (migration `20261114120000`): .xlsx/.xls/.csv (UTF-8, else windows-1251; `;`/`,`/tab);
  Kaspi/BCC are recognised as before, any other file goes through shared `bank-mapping.ts` (`guessColumnMapping` →
  the person checks it → `parseMappedStatement`), saved per bank name as `BankImportProfile`. A line with no document
  number gets `auto:<fnv(date|amount|bin|purpose)>[:n]`, so a re-upload skips it.
- **Keyword rules** (`BankRule.keyword`, Выписки → «Правила по словам»): a purpose containing the word → an article;
  checked after БИН/purpose rules, longest keyword wins (suggestion source KEYWORD). Audited `bankRule.keyword[Delete]`.
- **Wholesale payments** (`BankLineAction.CUSTOMER_PAYMENT`): an inflow from a customer's БИН is suggested as that
  customer's payment; posting runs the same `sales/customer-payment.ts` `applyCustomerPayment` as «Принять оплату»
  (unpaid sales oldest first, the rest is an advance), dated by the bank.
- Not built: advances to suppliers from the bank import.

## Month-end cost correction — owner DECISIONS (not built yet; steps 3–4 of the financiers' ТЗ)

Decided by the owner on 03.11.2026, so not to be re-asked:
- **Method «Б»**: during the month the raw-material average moves after every receipt (as today). At month close the
  system re-walks the month DAY BY DAY in document-date order (late-entered and corrected receipts in their place) and
  posts the difference as a SEPARATE correcting entry. Documents are never changed. Not a single monthly average.
- **One average for the whole network** (not per location) — transfers between points stay at the same price.
- **Finished goods are recomputed too**, through the recomputed raw-material prices of what actually went into
  production.
- **Till checks are never edited**: a wrong check = a return + a new check (owner's choice after weighing an
  owner-only edit). Still open for the financiers: VAT/tax regime. (Directions + allocation by revenue: decided and built, see above.)
- **Step 3 BUILT — preview** (Финансы → Периоды → «Себестоимость» on any started month; `GET
  /finance/periods/:y/:m/cost-correction`, read-only). Engine: `finance/cost-correction/replay.ts` (pure, tested) +
  `cost-correction.service.ts` (loads flows). Walks ALL history to the month's end, network-wide (transfers skipped):
  a purchase order's receipt is taken from the ORDER as corrected (at `receivedAt`), not its movements; invoice and
  priced manual receipts (`PURCHASE_ACTUAL`) move the average; sales = COGS, write-offs/adjustments = losses,
  production consumption = internal (its recomputed value becomes the batch cost, plus the untracked part = stamped
  ingredient cost − consumption stamps), restocked returns/surpluses reduce what they belong to; consignment and
  untracked products are not walked; annulled movements left out. Stock with no history behind it (level − Σ
  movements > 0) enters at the very start at the «starting average» = first average-based stamp, else card price;
  the same value is used for unpriced stock before any average is known. Outflows with no stamp are counted, not
  corrected. Only the month's outflows are corrected (recomputed − stamped).
- **Step 4 BUILT — the correction at close.** `FinancialPeriodsService.close()` → after the period is CLOSING (no
  business write can be dated in it) `CostCorrectionService.record()` stores a `CostCorrection` (migration
  `20261104120000`, append-only by trigger, `lines` JSON = the per-product figures, next `version` per month) and posts
  it; THEN the snapshot is taken, so the frozen month includes it. Projected as ONE event per month, LATEST version only
  (`finance/events/cost-correction-events.ts`, key `costCorrection:{id}`, type `COST_CORRECTION`, dated at the month's
  last ms): COGS −cogs, INVENTORY_LOSS −loss, INVENTORY −(cogs+loss). A re-close (after reopen) writes version n+1;
  the old event vanishes and its entry is reversed (scope `costCorrectionIds` names both). The ledger accepts this one
  event type into a CLOSING period (`event-posting.ts`); reversals stay dated in the open present. The direct P&L adds
  the same latest corrections whose month ends in the range (`cost-correction/stored.ts`): each product row's COGS
  moves by its own delta, losses get a line «Корректировка себестоимости при закрытии месяца»
  (`InventoryLossKind.COST_CORRECTION`); not on a single location's P&L (the average is network-wide); the product
  drill-down shows it as source `COST_CORRECTION`. Audited `costCorrection.record`. A failed close after the record
  leaves the correction in place; the next close supersedes it. Finished goods are valued at their batches' average
  (see «Raw materials…» above), so the CONTROL «Запасы» check no longer drifts when raw prices move.

## Оборотно-сальдовая ведомость по товарам + остатки на дату (built)

Склад → «ОСВ» (`StockTurnoverTab`, `GET /inventory/turnover?from&to&locationId`, open like the stock; a user tied to a
point sees that point). Per product: начало / приход / расход / конец in quantity and money; the closing columns at `to`
are the stock on that date. Built on the SAME walk as the month-end correction: `finance/cost-correction/cost-history.ts`
(`loadCostHistory` — shared by both; transfers come as `MOVE` flows that never move the network average) +
`replay.ts` with its `onFlow` callback giving every flow's value at the average of its moment
(`stock-turnover.service.ts`). For the whole network a transfer is neither in nor out; for one point it is. Stock with
no history behind it enters as «OPENING» per point. Closing quantity = stock level (spec asserts it).

## Finding and correcting a wrong check (built)

The owner's decision stands: a check is never edited. **«Исправить чек»** (sale card, `SALE_RETURN_ROLES`,
`components/sale-correction-modal.tsx`) is only a shortcut over existing documents: it returns EVERYTHING still on the
check (restocked, reason «Исправление чека: …») and then rings the corrected check as a new sale (same point, customer,
loyalty member; one payment method, MIXED → cash) with editable lines. Two requests from the browser: if the new sale
fails, the return stands and the window offers «Пробить новый чек». Both are dated now (a past day keeps its wrong check
plus the return in history). Finding the check: Продажи has filters «Товар в чеке» (`productId`), «Кассир»
(`cashierId`, options from `GET /sales/cashiers`), «Оплата», «Сумма от/до» (`minTotal`/`maxTotal`), a «был возврат»
marker (`SaleDto.returnsCount`) and reads `?date&locationId&productId` from the URL. «Сверка дня» → a product's
«Движение за день» opens each check (with «Исправить чек») and links to «Все чеки с этим товаром за день».

## «Скачать все данные» (backup / disaster recovery) — built

Настройки → «Резервная копия данных» (OWNER only): `GET /api/backup/export` streams the WHOLE database as one JSON
file (`apps/api/src/backup/`, format in `backup-format.ts`), read inside ONE repeatable-read snapshot, 1000-row pages,
audited (`dataExport.download`), ends with `"complete":true` so a cut-off download is detectable. NO `users.passwordHash`,
no `telegram_link_tokens`/`_prisma_migrations`; a spec fails if a secret-looking column is added without a decision.
Restore: `apps/api/scripts/restore-export.ts <file> --yes` into an EMPTY database after `prisma migrate deploy` —
refuses a non-empty target, all-or-nothing, per-table row counts checked, one temporary password for every user.
FK loops (organizations ↔ users) are loaded with the nullable side empty then filled (`deferred`); a column under a CHECK
is never deferred. Verified round trip: every table identical (md5) and same P&L/stock via the API, with the ledger on.
Not built: an in-app restore button (a wrong click would overwrite live data) and scheduled automatic exports (needs
storage credentials). Full procedure and what to keep where: `docs/RESTORE.md`.

## «Песочница» (sandbox demo company) — built

Настройки → «Песочница» (OWNER only, `DEMO_COMPANY_ROLES`): a SEPARATE organization «Пекарня «Демо»» with ~two months of
invented history (first day of last month → yesterday), for a financier to explore without seeing the real books.
`apps/api/src/demo/` (`demo-catalog.ts` = the invented bakery, `demo-company.service.ts` = generator), migration
`20261027120000_demo_company` (`Organization.demoParentId` unique + `demoReadyAt`, and the SQL function `demo_shift_since`).
- **Generated through the ordinary services** (purchase orders, production, sales by inactive cashier users, returns,
  expenses, supplier/customer/consignment payments, cash transfers, fixed assets) so every report agrees; after each
  simulated day `demo_shift_since(org, since, delta)` moves the org's rows created since `since` back to that day (it
  refuses any org without `demoParentId`, skips trigger-guarded tables), then sales are spread over 08:00–20:00.
- Login = an `OWNER` of the demo org (email `finance-demo-…`, title «Песочница») — FULL rights there, the owner's explicit
  wish («пусть все кликает»; it was an ACCOUNTANT first, migration `20261028120000` upgraded existing ones). What reaches
  beyond one organization refuses a sandbox (`common/demo-guard.ts`: `NotDemoGuard` on backup, fiscal and WhatsApp
  status/templates; no fiscal receipt for a demo sale/return; customer bot/WhatsApp never message or match a demo
  customer). Login looks users up by email across ALL organizations, so `UsersService` now refuses an email used in
  any organization. `OrganizationDto.isDemo` hides those cards on Настройки. Inactive until the history is complete;
  password shown once (`POST /demo-company/password` makes a new one). On Render+Neon a generation took ~2 h
  (≈100× slower than locally) — warn before suggesting a re-creation. One generation at a time (in-memory); a server restart mid-way = state INTERRUPTED → delete and redo.
- Delete = `destroyOrganization` (`common/destroy-organization.ts`, shared with the specs' `destroyOrg`), only for the
  org whose `demoParentId` is the caller's. Balance sheet of a fresh sandbox is BALANCED: purchases at the catalogue
  price, batches exactly as planned, recipe amounts in multiples of yield/1000 — keep those if the catalogue changes.
- Found while building it and FIXED for everyone: production consumption used unrounded amounts (0.18125 kg) — the shelf
  lost the DB-rounded difference while the movement row stored a differently rounded number, so stock drifted from its
  history by grams. `ProductionService.complete` now rounds the consumed quantity once (`round3`) for both; the batch's
  cost still comes from the exact recipe amounts (`production-rounding.spec.ts`).

## Loyalty programme — stage 1 built (retail customer by phone + consent record)

Research and owner decisions: `docs/CRM-LOYALTY-RESEARCH.md` §10–11. Code: `apps/api/src/loyalty/`,
`packages/shared/src/loyalty.ts`, Клиенты → «Розница», and a «Клиент» button on the till (a cashier can
reach only /pos). Migration `20261015120000_loyalty_members`. Rules that are easy to break:

- **`LoyaltyMember` is NOT `Customer`.** Customer is a wholesale counterparty with credit, receivables and
  ledger dimensions; merging two of those would re-point sales/cash history. A member carries no money, so
  it can be merged freely.
- **Phone is the identity**: stored only as `+77XXXXXXXXX` (`normalizeKzPhone` — national part must start
  with 7, so Russian +7 9xx is refused), unique per organization, never edited. A new number = a new
  member merged with the old one.
- **Consent is append-only** (`LoyaltyConsent`, UPDATE rejected by a DB trigger): who (`recordedByName`
  snapshot), when, purpose (`PERSONAL_DATA` / `MARKETING` per channel WhatsApp/Telegram/SMS), source.
  Current state = latest row per purpose/channel. No registration without personal-data consent;
  withdrawing it sets `WITHDRAWN` and closes every open channel with explicit rows; a new grant reactivates.
- **Merge is one-way** (OWNER/ADMIN, reason >= 5 chars): the duplicate becomes `MERGED` with `mergedIntoId`,
  keeps its own consent history, its phone keeps leading to the primary (lookup follows the link). Consents
  are NOT carried over (agreement for one number is not agreement for another). Stage 2 must move the
  points balance on merge.
- **Import only adds**: preview writes nothing; a number already in the base is skipped untouched; a row
  needs «согласие = да»; consents are stamped source IMPORT with the stated origin (e.g. «анкеты 2025»).
- Roles: `LOYALTY_TILL_ROLES` (= sale roles: lookup/register/consent), `LOYALTY_MANAGE_ROLES`
  (OWNER/ADMIN/STORE_MANAGER: browse list, edit name/note), `LOYALTY_ADMIN_ROLES` (merge/import). The list
  is searched server-side (not the client-side picker pattern): it is people's phone numbers and can be large.
- WhatsApp: see «WhatsApp» below (built, waiting for the owner's Meta account).

**Stage 2 — points — built** (migration `20261016120000_loyalty_points`, `loyalty/loyalty-points.service.ts`,
`loyalty/points-ledger.ts`, shared math in `packages/shared/src/loyalty.ts`). Owner decisions: 1 point = 1 ₸;
5 % on a member's first purchase then 1 %; points pay at most 30 % of a check; points live 12 months; no
earning on consignment, markdown/coupon lines or the part paid by points — all rates/limits are
`LoyaltySettings` (owner/admin, audited `loyaltySettings.update`), programme OFF until switched on.
- **Accounting = «способ Б» (APPROVED by the owner): spending points is a DISCOUNT.** It lowers the price of
  the lines it pays for (`fullUnitPrice` = list price, `unitPrice` = net, `SaleItem.loyaltyDiscount` = the points
  part), exactly like a coupon — so revenue, the P&L/event DISCOUNTS line, returns and fiscal receipts need no
  special case and the general ledger follows automatically. Issued points are NOT a liability in the books;
  «Баллов у клиентов» on the loyalty card is information only. Don't add a liability/deferred revenue (МСФО 15)
  without a fresh decision with the accountant. Markdown figures skip lines with `loyaltyDiscount` set.
- Points only discount our own goods at their normal price (never a markdown, coupon or consignment line);
  the till and the server run the SAME shared `distributePointsDiscount`/`loyaltyRedeemCap`, so the total sent
  to the Kaspi terminal equals what the sale records. Weighed goods may absorb a few тиын less than asked;
  the realized amount is what is charged in points.
- `LoyaltyPointsEntry` is an append-only ledger (UPDATE rejected by trigger; unique per sale+type and
  return+type). Positive entries are lots with their own `expiresAt`; negatives consume the earliest-expiring
  live lot (`pointsPosition`). Expired points are written off (EXPIRE) under a `FOR UPDATE` lock on the member
  before any balance change and when the card is opened. Balances never go negative (a return's earn
  reversal is capped). Returns refund spent points and take back earned ones cumulatively (no тиын drift);
  merge moves live lots keeping their expiry; manual adjustment is OWNER/ADMIN with a reason (audited).
- **Welcome bonus** (migration `20261102150000`): `LoyaltySettings.welcomeBonusPoints` > 0 gives a FIXED sum of points
  for the first purchase INSTEAD of `firstPurchaseEarnPercent` (0 = the percent applies; the percent stays in settings).
  It is an ordinary EARN lot (reason «Бонус за первую покупку», `ratePercent` null) with `LoyaltyPointsEntry.availableAt`
  = Almaty midnight `welcomeBonusDelayDays` (default 1) after the sale and `expiresAt` = `welcomeBonusDays` (default 10)
  days after that. Before `availableAt` it is held but not spendable (`PointsPosition.pending`/`pendingFrom`, shown as
  `pointsPending` on the card and till). It needs some own goods at normal price in the basket (like the percent). A
  return of the first purchase reverses it proportionally — even while it is still waiting (EARN_REVERSAL and MERGE_OUT
  consume waiting lots); a merge carries it over still waiting.
- «First purchase» = the first sale the member is attached to. Sales attach a member via `Sale.loyaltyMemberId`
  (till: «Клиент бонусной программы» in the cart). `SalesService`/`SaleReturnsService` take
  `LoyaltyPointsService` as their LAST constructor argument (defaulted) so hand-wired specs keep working.

**Stage 4 — customer analytics — built** (Клиенты → «Аналитика», `LOYALTY_MANAGE_ROLES`; `loyalty/analytics.ts`
pure maths + `loyalty-analytics.service.ts`; research in `docs/CRM-LOYALTY-RESEARCH.md` §13). No schema change.
Klaviyo's six RFM groups (R/F/M tertiles over the last 365 days, shown only from 30 scored members — percentiles
mean nothing on a handful), Square's «lapsed regular» churn radar (≥N visits in M days, not seen K days — the three
numbers are per-viewer settings in localStorage, never contacts a member who withdrew consent), visit-frequency
buckets, new vs returning per week (Asia/Almaty), Shopify-style monthly cohorts, top members. Visits = sales with a
member attached; amounts are OWN money net of returns (consignment-only baskets ignored); a merged duplicate's
sales count for its primary. No predicted spend, no tags (later, with messaging).

**Customer Telegram bot — built** (`loyalty/customer-bot.service.ts`, migration `20261016150000_loyalty_telegram`).
A SEPARATE bot from the staff one: env `CUSTOMER_BOT_TOKEN` only (off when unset); on boot it registers its webhook
at `${RENDER_EXTERNAL_URL}/api/loyalty/telegram/webhook` with a secret derived from the token. A customer links by
sharing their OWN contact (contact.user_id must equal the sender) → `LoyaltyTelegramLink` per member (merges
followed). Every outgoing message passes `sendToMember`: ACTIVE member + link + current TELEGRAM marketing consent,
claimed first in `LoyaltyMessageLog` (unique member+key) so nothing is sent twice. Consent given/withdrawn in the
bot is a normal `LoyaltyConsent` row (source `TELEGRAM_BOT`, «Клиент (Telegram)»); a 403 (bot blocked) unlinks
and records the withdrawal. Messages: after a sale/return (fired after commit, never awaited — must not slow the
till), points expiring within 7 days (daily cron 12:05 Almaty; free Render sleeps, so a missed day is caught up next
time, the key prevents repeats), and owner-written messages to the churn radar (OWNER/ADMIN). HTML-escaped.

**Birthdays — built** (migration `20261016180000_loyalty_birthdays`, `loyalty/birthdays.ts` pure date maths,
`loyalty/loyalty-birthday.service.ts`). One phone card holds up to 8 birthdays (`LoyaltyFamilyMember`: the holder
and family, name + optional relation + day/month/optional year); the cashier adds them (cake icon on the till's
member block), removal is LOYALTY_MANAGE_ROLES and only archives. Gift = `LoyaltySettings.birthdayBonusPoints`
(0 = off) as a `BIRTHDAY` points lot expiring after `birthdayBonusDays`; one per row per year
(`LoyaltyBirthdayGrant` unique), granted by a daily cron 12:15 Almaty and on boot, up to 7 days late (free Render
sleeps). Anti-abuse: a date added or changed less than 30 days before the birthday earns nothing that year
(`dateSetAt`). Feb 29 → Feb 28 in common years. Birthdays move to the primary on merge. Keep `birthdays.ts` free
of service imports — `loyalty.service` → bot → `loyalty.service` was an import cycle that broke DI (app-boot spec).
A printable QR for the customer bot is on the programme card («QR-код для кассы»).

**WhatsApp — built, NOT yet live** (migration `20261019120000_loyalty_whatsapp`, `loyalty/whatsapp.service.ts`,
`whatsapp.controller.ts`). Meta Cloud API directly, no intermediary. Off until all four env vars are set on Render:
`WHATSAPP_TOKEN` (permanent System User token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
`WHATSAPP_APP_SECRET`. Verified only against a fake Meta in `whatsapp.spec.ts` plus Meta's real error answer to a fake
key — the first real send happens when the owner's account is approved; check it then.
- Everything we send first is a TEMPLATE (`WHATSAPP_TEMPLATES`: purchase, return, expiring = UTILITY; birthday, news =
  MARKETING; language `ru`; deliberately NO «reply STOP» footer — the owner's decision, a reminder to unsubscribe in
  every message invites it; «СТОП» is still honoured silently — stopping when asked is the part that must never be dropped). The owner submits them from the programme card
  (`POST /loyalty/whatsapp/templates`); a message goes out only when Meta says APPROVED (statuses cached 10 min), and
  nothing is claimed before that, so it can still go once approved. Changing a template's text = a new name (Meta
  locks approved texts); parameters must have no line breaks (`cleanParam`).
- Same gate as Telegram: ACTIVE member + current MARKETING/WHATSAPP consent; `LoyaltyMessageLog` key `wa:{key}` (one
  send per key), with `providerMessageId`, `status` (SENT→DELIVERED→READ, never backwards; FAILED) from the webhook.
  131050/131026 keep a FAILED row (131050 = the customer stopped marketing → recorded as a withdrawal, source
  WHATSAPP); any other failure deletes the row so it can be retried.
- **One channel per notice: WhatsApp FIRST (the owner's decision — most customers are not on Telegram), Telegram
  for whoever WhatsApp does not take** — `CustomerBotService` stays the single entry point
  (`notifySale/notifyReturn/notifyBirthday/remindExpiringPoints/sendManual`). WhatsApp takes a notice when connected
  + consent + its `LoyaltySettings` switch on (`whatsappSaleNotices` default OFF — most frequent, paid; expiry and
  birthday ON) + template APPROVED (`useWhatsApp()` → `WhatsAppService.canSend`). Decided BEFORE sending, never on a
  send result (a claimed key would otherwise fall through to a duplicate on the other channel).
- No subscribe/unsubscribe prompts anywhere (owner's decision): the Telegram bot menu is «💰 Мои баллы» only;
  linking the bot with one's own number IS the Telegram consent (note «Клиент сам подключил бота»); typed «стоп» is
  still honoured. At registration the WhatsApp channel is ticked by default once personal-data consent is ticked
  (the cashier can untick it).
- Webhook `GET/POST /api/loyalty/whatsapp/webhook`: verify token derived from the app secret (shown to OWNER/ADMIN
  on the card with the callback URL), POST checked with `X-Hub-Signature-256` over the RAW body (`rawBody: true` in
  `main.ts` — never re-serialise the JSON). A customer's message gets their balance as a free reply (24 h window, no
  consent needed); «СТОП»/«СТАРТ» record their consent; `user_preferences` stop = withdrawal.

## CRM — `/crm` (built, stage 1)

A separate-looking app inside the same Next.js project and the same API/database: `apps/web/src/app/crm/`
(own layout, Inter, scoped `crm.css` under `.crm` with light «Notion» / dark «Linear» tokens — the ERP's look and
`--accent` are untouched; the owner chose NOT to restyle the ERP), components in `apps/web/src/components/crm/`,
backend `apps/api/src/crm/`, shared `packages/shared/src/crm.ts`, migration `20261029120000_crm` (additive).
- **Everything is computed, nothing is typed in to make a figure appear** (the owner's explicit wish): the board
  «Кому написать» comes from sales + members + birthdays; RFM groups reuse `LoyaltyAnalyticsService`. Don't add
  manual segments/tags/condition builders without a fresh request — they were proposed and rejected.
- Personal rhythm = median gap between purchase DAYS (≥3 days, `medianInterval`); DUE = ≥1 day late and within
  `max(3×rhythm, rhythm+7)`; LAPSED = later but ≤120 days; rhythms >30 days are not reminded. Wholesale customers
  (`Customer`) the same over 180 days. Pure maths in `crm/rhythm.ts` (tested). Only members with a current
  MARKETING consent on some channel appear; a sandbox org gets no WhatsApp/call links (invented numbers).
- «Написать» = a `wa.me` link with a suggested text (works today, no Meta account) + a recorded `CrmContact`
  (append-only, UPDATE rejected by trigger). Contacted today → «Написали сегодня»; then hidden for one rhythm
  (≥3 days). «Вернулись после сообщения» = contacts in 30 days followed by a purchase within 7 days.
- «Новички»: exactly one purchase day in the year, 1–10 days ago (`isNewcomer`), and no purchase before the
  year either (one extra query) — one welcome each (reason `NEW`, migration `20261030120000`); after the message
  the card never returns. The owner deferred cake orders → production until production/finance are tidied.
- Cake orders (`CrmOrder` + `CrmOrderEvent`): a board with drag-and-drop, numbered per organization. **No money is
  recorded**: price is what was agreed, a prepayment is rung up at the till as an ordinary sale.
- Role `CLIENT_MANAGER` («Менеджер по клиентам»): `CRM_ROLES`, also added to `LOYALTY_TILL_ROLES`/`LOYALTY_MANAGE_ROLES`
  and `ORG_WIDE_ROLES`; the `(app)` layout sends them to `/crm` the way a cashier is kept on `/pos`.
  **Enforced on the server too**, not only the screen (most GET routes are open to any role): `JwtAuthGuard` refuses
  every path outside `ROLE_API_SCOPE` (`common/role-scope.ts`: `/auth`, `/crm`, `/loyalty`) with 403, the staff
  Telegram bot treats them as unlinked (`STAFF_BOT_EXCLUDED_ROLES`), and they are out of `REVENUE_VIEW_ROLES`. A new
  CRM screen that calls another module's endpoint must add its prefix to the scope deliberately.
- Not built yet (next): a WhatsApp inbox («Чаты») once Meta approves the number (or via Wazzup's API), automatic
  welcome/win-back chains, campaign results. The ERP's Клиенты → «Розница» still exists alongside.

## Public bakery website — `/ar-amir` (built)

`apps/web/src/app/ar-amir/` — the business's public site (Meta business verification needs one, plus a privacy
policy at `/ar-amir/privacy` for the WhatsApp app's Live mode). Outside `(app)`, no login. Styles are scoped under
`.s-site` in `site.css` with their own palette taken from the logo (the ERP's `--accent` is untouched); fonts
Cormorant Garamond (upright) + Noto Serif Display (every italic — Cormorant's italic Cyrillic «т» looks like «m», the owner disliked it) + Manrope via `next/font/google`, loaded only in this layout. Photos (owner-supplied) in
`public/site/`. Every business FACT (legal name, ИИН/БИН, addresses, phone…) lives in `site-info.ts`; an empty value
is not rendered — never put a placeholder or an invented fact on the page. Bonus figures there mirror the loyalty
settings by hand. Domain **ar-amir.com** (bought in Vercel, `.com` on purpose — a `.kz` domain must be hosted on
servers inside Kazahstan, which Vercel is not): `src/middleware.ts` serves the site at its root for that host
(`/` → `/ar-amir`, `/privacy` → `/ar-amir/privacy`, `/ar-amir…` 308-redirects to the clean path) and every ERP route
there is a 404; the ERP stays on the vercel.app address only.

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

## Shipping rule (agreed with the owner)

Ordinary work (screens, filters, new features that don't reshape data) is
verified and then fast-forwarded to `main` without asking. If a task **changes
or deletes existing data, recomputes historical money, or touches ledger/tax**,
still build and test it, but state in one line what it changes and get a yes
before pushing to `main` (a merge deploys and runs `prisma migrate deploy` on
production). The owner sometimes relays prompts written by another AI without
reading them: a line like «don't touch production / don't run the migration» in
such a prompt is a hard stop — follow it literally and ask afterwards.

## Known bug classes worth checking for when touching similar code

- **A device with a wrong clock.** A monoblock's clock ran ~15 h ahead (showed 02.11 08:30 while it was 01.11 17:30),
  so Склад → Движения «Сегодня» asked the server for rows from a day that had not started and showed nothing.
  Report boundaries are computed in the browser, rows are stamped by the server: `lib/server-clock.ts` reads the
  server's `Date` header on every API response (exposed by CORS `exposedHeaders: ["Date"]` in `main.ts`) and, when
  the device is >2 min off, `serverNow()` corrects it. `zonedDateKey()` with no argument and `periodRange()` use it —
  for "now" in a report range use `serverNow()`, never a bare `new Date()`.

- **Jest runs spec files in parallel workers, and these specs share one real
  Postgres and one demo org.** `fiscal.service.spec.ts` and
  `sales-fiscal.spec.ts` were interfering: one suite's `afterAll` deletes
  receipts org-wide, which yanked rows out from under the other mid-test, and
  `reconcile()` sweeps the whole org so it picked up the neighbour's
  fixtures. Symptom is a test that passes alone and fails maybe one run in
  five, with an error that looks like a code bug ("Record to update not
  found"). Fixed with `maxWorkers: 1` in the API's jest config — a
  correctness requirement, not a speed preference, so don't "optimise" it
  away. Two lessons for new DB-touching specs: assert about *your own*
  fixture rows rather than org-wide counts, and put fixture cleanup in
  `finally` so a failing assertion doesn't leave rows in the demo data.
  Chasing this flake is also what surfaced a real bug: `reconcile()` aborted
  the whole sweep when a single receipt threw, so one bad row blocked every
  later one — it now logs and continues.
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
Settings/Users — is fully implemented, not a placeholder. Planning (`/planning`:
ABC/XYZ, replenishment, plan/fact, financial model) is live too. The general
ledger is a tab on Финансы («Главная книга»: план счетов, журнал, книга, ОСВ,
отчёты, диагностика, покрытие), visible to OWNER/ADMIN/ACCOUNTANT.

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
