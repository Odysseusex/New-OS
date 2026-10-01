# ArAmir OS — Phase 10: general ledger / double-entry accounting

Branch: `claude/assalyamualeykum-sessiya-xfakj8`. **Not merged to `main`, not deployed, no production database touched.**
Everything below was run against the local Postgres only.

```
OPERATIONS → ACCOUNTING EVENT → JOURNAL ENGINE → GENERAL LEDGER → TRIAL BALANCE / P&L / BALANCE / ДДС
```

## 1. Executive summary

A real double-entry layer now sits on top of the operational ledgers (`StockMovement`, `CashMovement`) that Phases 0–9 built. Every classified business fact becomes a **balanced, immutable journal entry**, traceable back to the document that caused it; the general ledger, trial balance, P&L, balance sheet and ДДС are read from those entries; and a diagnostics service holds the books up against the subledgers and against themselves.

Three things were deliberately **not** done, because the instructions forbid inventing them: there is no shipped chart of accounts beyond a minimal set of *system accounts the application itself posts to* (created only on request, renameable), no opening balance is ever converted automatically, and an operation whose other side is unknown is **left out of the book with a stated reason** rather than balanced by a suspense account.

The ledger is **OFF by default** (`Organization.ledgerStartsAt = NULL`). Deploying the migration changes no behaviour of the ledger itself. It does change four non-ledger things that were requested as approved decisions (§15.2) — read that section before deploying.

## 2. Files changed

**New — backend (`apps/api/src/ledger/`)**: `journal-math.ts` (exact decimal arithmetic, validation, `LedgerRejectedError`), `journal-core.ts` (the only place journal rows are created; reversal; periods; locks), `posting-rules.ts` (pure: event → balanced draft), `event-posting.ts` (the bridge the business modules call; idempotency; dimensions; production event), `ledger.service.ts` (chart of accounts, switching on, journal, manual/opening/reversal, general ledger, trial balance, catch-up posting), `ledger-reports.service.ts` (P&L, balance, ДДС from the ledger + reconciliation with the existing P&L), `ledger-diagnostics.service.ts` (20 checks + coverage), `ledger-period-section.ts` (freezes the ledger into a period snapshot), `ledger.controller.ts`, `ledger.module.ts`, `dto/ledger.dto.ts`. Also `finance/events/scope.ts`, `sales/refund-allocation.ts`, `test/support/ledger-fixture.ts`.

**New — shared / web**: `packages/shared/src/ledger.ts`; `apps/web/src/components/ledger-tab.tsx`, `ledger-panels.tsx`.

**Modified — wiring only (one `postLedgerSources` call each, inside the existing transaction)**: `sales.service.ts`, `sale-returns.service.ts`, `procurement.service.ts` (PO receipt), `invoices.service.ts` (confirm), `finance.service.ts` (expense create/confirm/cancel), `finance/cash-movements.service.ts` (**every** cash movement), `inventory.service.ts`, `stocktake.service.ts`, `fixed-assets.service.ts` (depreciation, disposal), `production.service.ts` (production event).

**Modified — the event projector** (`finance/events/projector.ts`, `accrual-events.ts`, `purchase-events.ts`, `fixed-asset-events.ts`): accept a transaction client and an optional *scope* (project only the named documents). Unscoped behaviour — what every existing report uses — is byte-for-byte the same.

**Modified — behaviour changes from approved decisions** (§15.2): `common/product-costs.ts` (D2), `recipes/recipes.service.ts` + `ai/business-context.service.ts` + `web/new-recipe-modal.tsx` (D1), `sales/sale-returns.service.ts` + `dto/create-sale-return.dto.ts` (D8), `packages/shared/src/costing.ts`.

**Other**: `schema.prisma`, `app.module.ts`, `audit/audit.ts` (+8 actions), `roles.ts` (+3 role arrays), `balance.service.ts` (three subledger readers made public), `finance/page.tsx`, `lib/api.ts`, `CLAUDE.md`.

**Tests**: new — `ledger/{journal-math,posting-rules,ledger-engine,ledger-flows,ledger-hooks,ledger-periods}.spec.ts`, `sales/refund-allocation.spec.ts`, `recipes/recipe-cost.spec.ts`. Updated deliberately — `finance-characterization.spec.ts`, `costing.spec.ts`, `sales/analytics.spec.ts` (§15.2).

## 3. Database schema changes (all additive)

- Enums: `LedgerAccountType` (ASSET, LIABILITY, EQUITY, REVENUE, COGS, OPERATING_EXPENSE, BELOW_OPERATING, TAX), `NormalBalance`, `AccountingEventStatus` (POSTED, NOT_POSTED, UNAPPROVED, NO_GL_EFFECT, EXCEPTION, REVERSED), `JournalEntryKind` (STANDARD, OPENING_BALANCE, MANUAL, REVERSAL), `JournalEntryStatus`; `ProductionCostComponent` gains `ABNORMAL_LOSS`.
- `organizations`: `ledgerStartsAt` (null = off), `journalEntrySequence`.
- Tables: `ledger_accounts` (code, name, type, normalBalance, parentId, isActive, systemAccountKey; unique `(org, code)` and `(org, systemAccountKey)`), `accounting_events` (eventKey, sourceType/Id, eventType, eventDate, period, status, statusReason, contentHash, metadata; **unique `(org, eventKey)`**), `journal_entries` (number, period, optional unique event, entryDate, description, kind, reference, createdBy/postedBy/At, **unique `reversalOfEntryId`**, reversalReason), `journal_lines` (debit, credit, amount, cashSection, dimensions: cashAccountId, locationId, productId, categoryId, customerId, supplierId, employeeId, financeCategoryId — plain columns, not FKs).
- **Database-level guards** (in the migration, outside what Prisma can express): CHECK that a line is exactly one positive side with `amount = debit + credit`; `BEFORE UPDATE` triggers that reject any change to `journal_entries` / `journal_lines`; a **statement-level `AFTER INSERT` trigger** that, for the set of lines arriving in one statement, requires ≥ 2 lines, debits = credits, and that the entry had no lines before. Proven against a client that bypasses the application (`ledger-engine.spec.ts`).

Why statement-level and not a deferred constraint trigger: the database client in use does **not** report a failure at `COMMIT` — the transaction silently rolls back and the caller is told it succeeded (reproduced; a sale would "work" and not exist). A statement-level failure is reported immediately.

## 4. Migration

`20261001090000_general_ledger`. Verified: applies on an empty database (all 53 migrations) with `prisma migrate diff` exit 0 / "No difference detected"; applies on top of the existing dev database; no column dropped, retyped or back-filled; existing rows untouched. `ALTER TYPE … ADD VALUE` and the new `organizations` columns (nullable / default 0) are instant.

## 5. Accounting architecture

- **One set of rules.** The meaning of every business fact already lives in `FinancialEvent` (Phase 4/8) and each classified event is proven to balance by invariant I1 (`assets − liabilities − equity − result = 0`). The ledger therefore *reads* those events: `posting-rules.ts` maps cash legs → Касса/Банк (by the cash account's own type), balance legs → system accounts (an asset grows with a debit, a liability/equity line with a credit), result legs → revenue/expense accounts (income = credit, expense = debit). Because I1 holds per event, Σ debit = Σ credit per entry follows — and is re-proven on exact decimals before any row exists. There is no second accounting system to drift from the first.
- **Posting engine** (`journal-core.ts`) is the only creator of journal rows: validates shape/balance in memory; requires the ledger on and the date ≥ its start; requires every account to be the organization's and active; resolves/creates the month's `FinancialPeriod` (race-safe `ON CONFLICT DO NOTHING`) and refuses non-OPEN periods; numbers the entry from an atomic increment (gapless: a rolled-back transaction gives its number back); inserts all lines in one statement.
- **Idempotency & concurrency**: unique `(org, eventKey)` + `pg_advisory_xact_lock` per key. Five concurrent posters of one sale → one entry per event; three concurrent catch-up runs → each event once; four concurrent reversals → exactly one.
- **Atomicity**: posting runs on the caller's transaction. Expected conditions (unclassified, system account missing, closed period, before ledger start, opening events) never fail the business operation — they leave a `NOT_POSTED`/`UNAPPROVED` event with a reason. A genuine fault propagates and rolls back the operation *and* its entries.
- **Reversal**: a new entry with sides swapped, dated in the open present, linked by the unique `reversalOfEntryId`, reason required, audited; the original is never touched; a reversal cannot be reversed; the source event becomes `REVERSED` and is never auto-reposted. A cancelled expense is reversed automatically (`SOURCE_CANCELLED`).
- **Periods**: reuses the existing OPEN/CLOSING/CLOSED lifecycle. Closing a month also freezes the ledger's trial balance, P&L and balance sheet into the `PeriodSnapshot` (`generalLedger` section; `null` when the ledger is off). A closed month takes no postings; the refusal says to correct in the current period.
- **Audit**: journal entries are self-auditing (author, time, source, accounting event, period — and immutable). Deliberate human actions are in `AuditLog` (`ledger.enable`, `.systemAccounts.init`, `.account.create/update`, `.entry.manual/opening/reverse`, `.postPending`) in the same transaction, with before/after and reason.
- **Security**: every query and mutation is scoped by the caller's organization (an id from another organization is "not found"; posting into another organization's account is refused). Class-level `LEDGER_VIEW_ROLES` (OWNER/ADMIN/ACCOUNTANT); posting/reversal `LEDGER_MANAGE_ROLES` (same); switching on and creating system accounts `LEDGER_SETUP_ROLES` (OWNER/ADMIN).

## 6. Posting flows implemented

| Business operation | Event(s) | Journal |
|---|---|---|
| Sale | `sale`, `sale:cost` | Dr Дебиторская / Dr Скидки, Cr Выручка; Dr Себестоимость, Cr Запасы (stamped cost) |
| Customer payment / sale receipt | cash event | Dr Касса/Банк, Cr Дебиторская |
| Sale return (+ restocked cost) | `saleReturn`, `…:cost` | Dr Возвраты, Cr Дебиторская; Dr Запасы, Cr Себестоимость |
| Refund | cash event | Dr Дебиторская, Cr Касса/Банк — **split across tenders by D8** |
| PO receipt (after cutover) | `purchaseOrder:…:receipt` | Dr Запасы, Cr Кредиторская — поставщики |
| Supplier payment / reversal | cash event | Dr Кредиторская, Cr Касса/Банк (and the opposite) |
| Legacy invoice confirm | `invoice:…:receipt` | Dr Запасы, Cr Кредиторская |
| Expense (confirm) / payment | accrual, cash | Dr its P&L line (or Основные средства / Изъятия / Займы), Cr Кредиторская — расходы; Dr Кредиторская, Cr Касса/Банк |
| Write-off / count difference | `stock:…` | Dr Потери запасов, Cr Запасы (or the reverse for a surplus) |
| Transfer between own accounts | `transfer:…` | Dr one, Cr other (nets to zero; pairing handled when the second leg arrives) |
| Owner contribution / withdrawal, loan in / repayment, capital purchase | cash events by category classification | Dr Касса, Cr Взносы / … |
| Depreciation, disposal | `depreciation:…`, `fixedAsset:…:disposal` | Dr Амортизация, Cr Основные средства; disposal at book value, gain/loss to Прочие |
| Production batch | `batch:…:production` | **No ledger effect** (raw → finished goods at cost inside the single inventory account): recorded as `NO_GL_EFFECT` with consumed/output value; a mismatch would be an `EXCEPTION` |
| Opening position | — | **Never automatic** (§12) |
| Manual entry, opening-balance entry, reversal | — | explicit, by a person |

Dimensions put on every line from the source document: location, customer, supplier, product + product category (stock movements), finance category; the cash account and cash-flow section on cash lines.

## 7. Reports implemented

`/ledger/…` (all from posted lines only): account **general ledger** (opening balance, period debit/credit, closing, running balance, source link; filters date/location/type/product/customer/supplier), **trial balance** (opening / debit / credit / closing; totals and `difference`, never absorbed), **P&L** (revenue − discounts − returns = net revenue; − COGS = gross profit; − losses − opex − depreciation = operating profit; ± below-operating; − tax = net profit; optional by location), **balance sheet** (assets / liabilities / equity from account balances; equity = capital accounts + result, split retained vs current month; `difference` shown, never an account), **ДДС** (opening cash from the ledger, sections from the cash line's section, transfers apart, opening position as a start not an inflow, closing = cash + bank), **P&L reconciliation** against the existing report line by line, **diagnostics**, **coverage**. The existing owner-facing reports are unchanged.

## 8. Frontend

Финансы → **Главная книга** (OWNER/ADMIN/ACCOUNTANT only): Обзор (status, create system accounts, start, opening-balance proposal, catch-up posting), План счетов (add/edit/disable, hierarchy), Журнал проводок (filters, expand lines + source, manual entry with live balance check, reversal), Главная книга (per account), ОСВ, Отчёты (P&L, ДДС, balance, reconciliation), Диагностика, Покрытие. Browser-tested end to end (16/16 Playwright steps, screenshots reviewed); no console errors.

## 9. Tests added

| Spec | Covers |
|---|---|
| `journal-math` (9) | exact decimals, rejection of negative / two-sided / zero / one-line / unbalanced, scale refusal, large sums — **B, C, X** |
| `posting-rules` (15) | every event shape → the right accounts, sides, balance; unknown other side not posted; opening never converted — **A, O, P, R, S** (rule level) |
| `refund-allocation` (9) | proportional split, largest remainder, order independence, override validation — **T** |
| `ledger-engine` (24) | off by default, setup, A–C, DB-level bypass attempts, **D, E, F, G, U, V, W, X**, chart rules, opening, audit coverage |
| `ledger-flows` (20) | one day of a bakery end to end, every balance worked by hand — **H, I, J, K, L, M, N, O, P, Q, R, S, T**, coverage, diagnostics detecting real faults |
| `ledger-hooks` (8) | invoices, transfers, stocktake, fixed assets (acquisition → depreciation → disposal), refund override, roles |
| `ledger-periods` (6) | close freezes the ledger, refusal in a closed month, reversal in the present, reopen |
| `recipe-cost` (1) | D1: card = costing service, loss not taken twice |

## 10–11. Test results

- Backend: **33 suites / 380 tests pass** (was 25 / 289). `app-boot.spec` (compiles the whole `AppModule`) passes. 0 leftover `iso-*` organizations.
- `tsc --noEmit`: shared, API, web — clean. `nest build` and `next build`: succeed.
- Existing tests: all pass. Fourteen assertions were changed **on purpose**, each with its reason in the test (§15.2): the three characterization "KNOWN DEFECT" pins for D1/D2 and the numbers that follow from them (COGS, gross/operating/net profit, inventory valuation), the cost-component count (6 → 7), and the analytics fixture (its purchase orders are now RECEIVED, as a real purchase is).
- Migration: fresh deploy + drift check clean (§4).

## 12. Accounting diagnostics (result)

Twenty checks, each returning `{check, status, expected, actual, difference, severity, source}`: TB balanced · Assets = L + E · inventory / AP / AR / cash-bank / fixed-asset subledger = ledger · P&L result = equity result · ДДС closing = cash + bank · no orphan events · no orphan or empty entries · no unbalanced entries · no duplicate posting · every entry has an organization period · nothing posted into a closed period · no negative/zero amounts · no foreign or mistyped accounts · no posted event whose source vanished · no source drift since posting · no unposted operations since the start.

In the end-to-end scenario **all 20 pass**, with the ledger tying to every subledger to the cent (inventory 19 150, cash+bank 16 900, AR 600, AP 2 000, fixed assets 2 000) and the ledger P&L equal to the existing P&L on every line. The same suite then breaks three things on purpose (cash balance off by 5, an event "posted" with no entry, an entry with no lines) and confirms the diagnostics report exactly the right four failures and recover when repaired. A manual stock receipt (other side unknown) shows up as an inventory difference of exactly its value, never absorbed.

## 13. Coverage report (what is and is not in the ledger)

`GL_POSTED` in the scenario: sales, returns, purchases, supplier payments, customer payments/refunds, expenses, write-offs and stocktake, transfers, owner operations, fixed assets. `UNAPPROVED` (by design): **opening balances (D3)**, **production** (D6), **taxes (D5)**, **payroll** (no accounting of payroll exists). `NOT_POSTED`: any operation whose other side is unknown (a stock receipt with no purchase document, an unclassified cash movement). History dated before the start date is counted separately as **not migrated** and is never converted.

## 14. Known limitations

- Existing owner-facing P&L / balance / ДДС are still the *old* code paths; the ledger's versions sit beside them with a reconciliation. Switching the UI over is a later, deliberate step once the reconciliation has been clean on real data.
- **Raw materials and recipe-costed goods are not moving-average** (§15.2): only bought-in goods use the weighted purchase average.
- **No WIP.** Production is atomic (consume + output in one transaction), so the raw → WIP → finished chain collapses to a value-neutral event; separate raw / finished-goods inventory accounts need per-product-type legs in the event layer and are not built.
- Inventory is **one** account; no stage split. No year-end closing entries: results stay on their accounts and the balance sheet *presents* retained vs current-month result.
- Department / project / cost-centre dimensions do not exist in the schema.
- Payroll, tax, VAT, supplier returns, loans as documents: no accounting (events for them do not exist; none were invented).
- Period-close preflight does not yet list unposted ledger events (the snapshot does freeze the ledger).
- Journal numbering takes a row lock on the organization for the rest of the transaction: fine at bakery volume, a throughput ceiling at scale.
- `postPending` re-projects the whole organization (read-only) before batching; fine at bakery volume.
- A sale/return/PO paid or returned *through the Telegram bot* is covered (it calls the same services in-process); the hard-delete paths for products/customers never touch the ledger (dimensions are not FKs).

## 15. Policies

**15.1 Still NOT approved (nothing defaulted):** D3 opening-balance completeness · D4 depreciation method/life/capitalisation (an asset depreciates only when its terms are stated; nothing is posted otherwise — tested) · D5 tax/VAT (no rates, no liabilities; `TAX` account type exists and is posted only for categories the owner classified as income tax) · D6 production cost components (`ABNORMAL_LOSS` added to the component list, never written; nothing capitalised but ingredients).

**15.2 Approved decisions and what they changed in existing behaviour — read before deploying:**
1. **D8 (mixed-tender refund).** Before: a refund on a *mixed* sale came back entirely from the default bank account. Now: split across the original tenders in proportion (cash share from that location's till, card/transfer share from the bank), whole tiyn by largest remainder, optional explicit `refundSplit` override that must add up and stay within each tender.
2. **D1 (recipe yield).** Before: the recipe card divided ingredients by `yield × (1 − loss%)` while the cost service divided by `yield` — two numbers for one loaf. Now both divide by `yield`. **Recipe cards show a lower unit cost and a higher margin wherever a loss % is set**; the live form agrees; the AI context's `effective_yield` equals the yield.
3. **D2 (weighted average).** Before: the purchase-average cost counted PLACED and CANCELLED orders and ignored supplier invoices. Now: RECEIVED orders at delivered quantity/cost + CONFIRMED invoices. Consequences: a product whose only "purchases" were placed orders loses its cost (shown as *unknown*, which is the honest state); a product with only confirmed invoices gains one. Already-stamped sales and movements keep their stamp (tested: a cake sold at 300 stays 300 after an invoice brings the average to 200). Sales lines with **no** stamp (pre-Phase-3 history) fall back to today's cost, so their COGS can move; closed months are frozen by snapshots. The P&L cost label changed from «текущий расчёт (политика не утверждена)» to «средневзвешенная стоимость закупок; ингредиенты — по цене из номенклатуры».
4. **D7 (card commission).** No code special-cases it: a commission is just an expense in a classified category, so revenue stays gross (tested: sale 10 000 by card, expense 200 → revenue 10 000, bank 9 800).

## 16. Migration risks

1. Behaviour changes in §15.2 are live the moment this is deployed, ledger on or off — D2 in particular can move reported COGS/margins for bought-in goods and for unstamped history.
2. The ledger itself is inert until an owner/admin creates the system accounts and picks a start date; there is deliberately no UI to switch it off again (set `ledgerStartsAt` to NULL by SQL on a Neon branch first if it were ever needed; entries are kept).
3. When switched on, every sale, cash movement, receipt, expense and write-off does a handful of extra reads/writes in its own transaction. A bug in the rules would roll the *operation* back (not corrupt the books) — that is the intended trade; expected conditions never do.
4. The start date matters: events at or after it that the hooks never saw (recorded while the ledger was still off) are picked up by «Провести непроведённые»; earlier ones never are.
5. Until the opening entry is posted, the subledger reconciliations will show differences. That is the diagnostics doing their job, not a fault.

## 17. Recommended next phase

1. Run the ledger on a **Neon branch** copy of production first: create system accounts, start at the beginning of the current month, post the reviewed opening entry, run diagnostics and the P&L reconciliation for a few days.
2. Once the reconciliation is clean on real data, switch the owner-facing P&L / balance / ДДС to the ledger-backed versions and retire the duplicated aggregation.
3. Decide D3–D6 (one at a time) — each unlocks a specific, already-architected piece: opening completeness → automatic opening; D4 → depreciation posting by default; D5 → tax accounts and payables; D6 → split inventory into raw / WIP / finished goods and capitalise labour/overhead.
4. Period-close preflight: list unposted ledger events of the month; add per-receipt moving average for ingredients if the owner wants D2 applied there too.

## Safe rollout (when approved)

```bash
cd apps/api && npx prisma migrate status                 # expect: 1 pending (20261001090000_general_ledger)
npx prisma migrate deploy                                  # additive; run by Render's deploy as before
# then, in the app (OWNER/ADMIN): Финансы → Главная книга → Создать системные счета → Запустить
#                                  → Подготовить проводку начального остатка → проверить → Провести
#                                  → Диагностика, Отчёты (сверка), Покрытие
```
