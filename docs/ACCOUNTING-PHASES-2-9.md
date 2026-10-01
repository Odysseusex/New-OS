# ArAmir OS — accounting Phases 2–9 (feature branch, NOT deployed)

Branch: `claude/assalyamualeykum-sessiya-xfakj8` (on top of Phase 1 = `d050abd` = `main`).
Nothing here is merged to `main`, deployed, or run against production.

## 1. Commits

| Commit | Content |
|---|---|
| 4d05e3c | Phase 2 — stocktake |
| 324f33c | Phase 3 — cost snapshots, CostingService, P&L ladder |
| a045a92 | Phase 4 — category classification, cash-side events, sectioned ДДС |
| cd68e4e | Phase 5 — PO payments/reversal, cutover, race-safe documents |
| eee19f8 | Phase 6 — financial periods |
| f68daf0 | Phase 7 — fixed assets, depreciation registry |
| 5672db4 | Phase 8 — full event catalogue, balance without plug, roll-forward, monthly report |
| 9702aee | Phase 9 — planning / forecast |
| 2c3e33d | Master-data audit + Settings cards (policy, audit log) |
| (last)  | DI fix, stocktake UI fix, boot spec, docs |

## 3–4. Migrations / schema (all additive; verified on empty DB and on a Phase-1 DB with data)

1. `20260930080330_stocktake` — `stocktakes`, `stocktake_lines`, `stock_movements.stocktakeId`
2. `20260930114200_cost_snapshots` — `unitCost/costBasis` on `sale_items`, `sale_return_items`, `stock_movements`; `production_batch_costs`
3. `20260930115006_category_classification` — 3 enums + 3 columns on `finance_categories` (default UNCLASSIFIED)
4. `20260930115926_purchase_payments_and_cutover` — `purchase_order_payments`, PO `receivedTotal`, item `receivedQuantity/UnitCost`, `organizations.purchaseCutoverAt`, `cash_movements.purchaseOrderPaymentId`
5. `20260930120545_financial_periods` — `financial_periods`, `period_snapshots`
6. `20260930121015_fixed_assets` — `fixed_assets`, `depreciation_entries`, `cash_movements.fixedAssetId`
7. `20260930122347_management_planning` — `management_plan_lines`, `financial_model_scenarios`

No column is dropped, retyped or back-filled. Existing rows keep NULL / UNCLASSIFIED.

## 11. Migration rehearsal (local Postgres, not production)

- All migrations on an empty DB: applied; `prisma migrate diff` against the schema: exit 0 (no drift).
- Phase-1 DB with 17 seeded tables of rows → Phases 2–9 applied: row counts identical, money/stock fingerprint identical, new columns NULL/UNCLASSIFIED, new tables empty, drift check exit 0. `finance:diagnostics` reads the upgraded DB.

## 8–10. Verification results

- Backend tests: **25 suites / 289 tests pass**; 0 leftover `iso-*` organizations.
- `tsc --noEmit` api + web: clean. `nest build`, `next build`: pass.
- Playwright (owner, built app): 19/19 checks (finance Баланс/Основные средства/Периоды/классификация/P&L/ДДС, инвентаризация, закупки (приёмка), планирование ×4, настройки (политика, аудит)); 0 page errors, 0 failed API calls.
- Mutation checks: removing the PO row lock → concurrent-overpay test fails; re-adding an un-injectable constructor param → `app-boot.spec` fails.
- Defects found by the final verification and fixed: Nest DI failure on boot (`FinancialPeriodsService` array param; `AccountingPolicyService` not exported); stocktake UI crash (`updateLine` returns a line, not the document).

## 12. Behaviour changes (intentional; each pinned by an updated test)

- P&L: `revenue` = **net** revenue (returns subtracted); restocked returns give cost back, scrapped ones keep it; new ladder (gross → discounts → returns → net → COGS → gross profit → inventory losses → opex → depreciation → operating profit → other → pre-tax → tax → net); net profit is PRELIMINARY while tax is unconfigured; `Dashboard.netProfit` no longer equals operating profit; money rounded to 2 dp.
- COGS reads the cost stamped at sale; ingredient-price edits no longer rewrite history (legacy lines fall back to today's cost and are counted).
- ДДС: transfers and opening balances no longer inflate inflow/outflow; sections Operating/Investing/Financing/Unclassified/Internal; reconciliation with accounts.
- Capital-category expenses are not P&L expenses; classified cash adjustments/other income reach «прочий результат»; break-even ignores non-operating expenses.
- Cash adjustment now REQUIRES a fully classified category; deposit/withdraw accept an optional one.
- Transfers/adjustments/invoice payments/PO payments are atomic; PO receive, invoice confirm/cancel, expense confirm, finance-setup completion are single-winner under concurrency.
- After the purchasing cutover: payable at receipt, invoices cannot be created. Before it: unchanged.
- PO receive now opens a modal (actual quantity/price).

## 13. Unresolved human decisions (left unresolved, labelled in the product)

D1 recipe yield/loss · D2 cost-flow (shown as «текущий расчёт (политика не утверждена)») · D3 opening completeness (pre-go-live cash is reported in CONTROL) · D4 depreciation/capitalisation (nothing assumed) · D5 tax/VAT (no tax driver; PRELIMINARY) · D6 production cost components (only INGREDIENT) · D7 card commissions · D8 mixed-tender / unpaid credit-sale refund (service still refuses refunds above what was paid).

## 14. Known risks

- Real data will likely show a non-zero CONTROL (cost-basis difference, pre-go-live cash, unregistered capital expenses). That is the design, not a bug; do not "fix" it by editing data.
- `finance:diagnostics` baselines taken before/after will differ in P&L (intended) — compare only the figures listed in §12.
- Balance for a past date uses today's stock levels rolled back by movements and today's costs.
- Period diagnostics run several full-organisation reads; fine now, revisit at scale.

## 15. Technical debt

- Older specs (sales-fiscal, fiscal, consignment, sale-returns, promotions, analytics, missing-bank-account) still share `demo-org` and grow local cash drift — not isolated.
- P&L is rebuilt-from-events only as a parity check (`pnlFromEvents`), the direct implementation is still the source of the screen.
- Gain/loss on asset disposal is booked to «прочий результат» (not separately configurable).
- Production, transfers and PO-before-cutover are not full balance events (net-zero / unknown counter-side).
- Reports page was not given a monthly-report tab (the data is at `GET /finance/monthly-report` and in period snapshots).
- Unrelated pre-existing consignment-product write-off valuation is cost-unknown.

## 16. Adversarial audit A–T

| | Check | Result | Evidence |
|---|---|---|---|
| A | Balance plug | PASS | `balance.spec` "no plug": unclassified money moves Assets and CONTROL only, equity unchanged; control lines sum to the difference with no remainder line |
| B | Historical COGS stability | PASS | `costing.spec` price change leaves reported COGS and stamps unchanged |
| C | PO AP before receipt | PASS | `procurement.spec` placed order owes nothing |
| D | Concurrent PO overpay | PASS | simultaneous payments → one wins; mutation (lock removed) fails the test |
| E | Return double-count COGS/loss | PASS | `costing.spec`, `balance.spec` return economics; scrap marker not a loss |
| F | Return WRITE_OFF marker stock effect | PASS | `ledger-effects.spec`, roll-forward shows only the real write-off |
| G | Transfers inflating ДДС | PASS | `characterization`, `events.spec` |
| H | Unclassified cash disappearing | PASS | UNCLASSIFIED section; sections sum to net flow |
| I | Closed period silent change | PASS | `periods.spec`: guard, frozen snapshot, tampered data does not move it |
| J | Depreciation double run | PASS | `fixed-assets.spec` incl. simultaneous runs |
| K | Model mutating accounting data | PASS | `planning.spec` row counts of 14 accounting tables identical |
| L | Concurrent negative inventory | PASS | `stock-guard.spec` (Phase 1) |
| M | Concurrent cash corruption | PASS | `cash-movements.spec`, `events.spec` (adjust/transfer races) |
| N | Audit surviving failed mutation | PASS | `audit.spec`, `master-audit.spec` rollback tests |
| O | Missing policy becoming a rule | PASS | policy method alone does not depreciate; tax null; replenishment defaults flagged |
| P | Legacy invoices double-counting AP | PASS | `procurement.spec` AP = open invoices + open post-cutover orders = event payable |
| Q | Projection replay differences | PASS | byte-identical replays in `events.spec`, `balance.spec` |
| R | Opening equity as plug | PASS | opening equity stays the declared figure |
| S | Fixed assets silently expensed | PASS | capital expense excluded from P&L, listed until registered |
| T | Supplier returns without redesign | PASS | `supplierReturnEvent` semantics test; no workflow/source |

## 17. Deviations from the master spec

- Frontend: balance/roll-forward live on the Finance «Баланс» tab, not in Reports.
- "P&L on events" implemented as a parity check, not as the screen's data source.
- Disposal gain/loss is not separately configurable.
- Opening fixed assets after go-live are allowed for OWNER/ADMIN with a reason (otherwise they could never be registered).
- Replenishment lead time/safety/review days default to labelled illustrations when not stated.

## 18. Safe production rollout (nothing here was run against production)

```bash
# 1. Neon branch of production (Neon console), then, from apps/api:
export DATABASE_URL="<neon-branch-url>"
npx prisma migrate status
pnpm finance:diagnostics baseline --org <orgId> --from 2026-01-01 --to 2026-12-31 --out before.json
npx prisma migrate deploy            # 7 additive migrations
pnpm finance:diagnostics consistency --org <orgId>
pnpm finance:diagnostics baseline --org <orgId> --from 2026-01-01 --to 2026-12-31 --out after.json
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
# 2. Point a staging API at the branch, log in, walk Финансы → Баланс/Периоды/Статьи ДДС, Склад → Инвентаризация.
# 3. Only after approval: merge the branch to main; deploy exactly as Phase 1 was (Render Manual Deploy), then verify /api/health commit.
# 4. Optional, separate, owner-initiated decisions after deploy: classify finance categories; Закупки → «Перейти на новый порядок» (one-way).
```
Rollback: the migrations are additive — redeploy the previous commit; new tables/columns are simply unused. Do not run tests against the production database (the test host guard refuses it).
