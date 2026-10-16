# Handoff — state of the work (written 2026-10-15)

For a fresh session: read `CLAUDE.md` first (it is loaded automatically), then this file. This lists what was
done in the long session that ended here, and what is still open. The owner is not a developer; talk to them in
simple Russian (see CLAUDE.md conventions).

## Shipped to `main` in that session (all deployed through Render/Vercel)
* Mass product classification (Склад → Категории → «Классификация»): preview/apply/audit/rollback, bulk SQL
  (a first version timed out against Neon), history freeze migration, POS shows main categories only,
  23-category standard catalogue. Whether the owner pressed «Применить» on production is NOT recorded here — ask.
* Semi-finished products (полуфабрикаты): stage 1 (virtual, expanded to raw materials) and stage 2 (held as
  stock, own batches, moving weighted-average cost). Details: `docs/SEMI-FINISHED-DESIGN.md`.
* Sales screen shows own revenue, goods «под реализацию» and turnover side by side.
* Finance page loads only the active tab (it used to run the P&L four times on open).
* POS markdown −30 %. Category list keeps its scroll position. Cost-basis label for stocked semi-finished.

## Open items / decisions waiting for the owner
* «Сегодня» / «7 дней» on the Sales screen are computed in server (UTC) time, not Asia/Almaty — fix proposed, not done.
* Mass flagging of goods «под реализацию» by SKU file (the village's goods): proposed, NOT built. The owner saw a
  P&L warning «259 позиций без себестоимости» and was asked to send a screenshot of which products they are.
  Old sales lines keep the flag they had at sale time; re-stamping history changes historical money (needs a yes).
* Promotion «Мерей» has category rules; the classification moves ~22 products out of those categories. The
  owner has not yet looked at the percentages.
* Packaging as a recipe ingredient: undecided (workaround: a raw item «Упаковка»). No «Полуфабрикаты»
  category was created. The filling-per-pie norm is deliberately NOT invented: owner measures it, then adds the
  filling to the pie recipe (until then the card shows «Не учтено: начинка»).
* Known, accepted limitation: finished goods are valued at TODAY's recipe cost, so a price move revalues goods
  on the shelf and the ledger-vs-valuation diagnostic can show a small difference.
* Waste of vegetables: modelled as a virtual semi-finished product «X очищенный» (raw → yield = clean weight).
  No per-day actual waste entry or waste report exists.
* iiko: no access and no integration (Интеграции stays deferred). Fiscal (re:Kassa) work is in CLAUDE.md.

## New topic being started: CRM + loyalty program + WhatsApp Business API
Owner decisions are in docs/CRM-LOYALTY-RESEARCH.md §10 (5% first purchase, then 1%; points payable at the till). Stage 1 (customer by phone + consent record) is BUILT on branch `claude/loyalty-phase1` (§11 there, and CLAUDE.md); it adds a migration, so it waits for the owner's yes before going to `main`. Stage 2 (points, till, returns, expiry, settings) is BUILT on the same branch (§12 there) — it adds migration `20261016120000_loyalty_points` and changes how a sale is priced when points are spent, so it waits for the owner's yes before `main`. The programme stays OFF until the owner ticks «Программа включена». The owner wants a CRM and a bonus programme «like Sagi» (will send screenshots) with WhatsApp
sending. Questions for the design: one platform vs separate; the existing `Customers` module and promotions/
coupons are the starting point; WhatsApp needs a provider, verified business, approved templates, opt-in, paid
per message — verify current prices from the provider's pages before quoting any number.

## Environment notes (this sandbox)
* The container can be recreated between turns: the local Postgres database, `apps/api/.env` and `node_modules`
  may be gone. Rebuild: `sudo pg_ctlcluster 16 main start`, set the `postgres` password to `postgres`, create
  `bakery_os`, copy `.env.example` to `.env`, `pnpm install`, `npx prisma migrate deploy`, `npx ts-node prisma/seed.ts`.
* Use `PGPASSWORD=postgres` with every `psql` call (a missing password blocks the shell).
* No access to the production database, Render logs or credentials; never ask the owner to paste secrets in chat.

## Loyalty status (2026-10-16)
Stages 1, 2 (points, live and switched on by the owner) and 4 (customer analytics, Клиенты → «Аналитика») are on
`main`. Next candidates: Telegram notifications to members (free, bot exists), then WhatsApp (needs the owner's
Meta business account + provider). Consent wording still awaits a lawyer. Sales «Сегодня/7 дней» UTC bug still open.
