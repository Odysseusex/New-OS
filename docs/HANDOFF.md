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
* 2026-10-18: P&L shows a display-only line «Под реализацию (вне выручки)» (in no total). Baker's calculator on
  recipes/tasks (quantity or flour weight → grams, % к муке, mixes by «Вместимость замеса»), see CLAUDE.md.
* Open (asked 2026-10-18, not built): raw materials at «Мерей» were never consumed because finished goods were
  received by hand instead of produced. Proposed: a read-only «сырьё по продажам за период» report first, then (only
  with a yes — stock/ledger) a write-down of raw against that unexplained receipt that leaves the P&L unchanged.
  Do NOT advise a manual write-off: COGS is already in the P&L, it would count twice.

* 2026-10-23: «Сверка дня» (Продажи → «Сверка дня»): the day's expected cash/card and closing stock per product
  vs what was counted; see CLAUDE.md. The operator role can now plan/complete production tasks.

* 2026-10-23: «Скачать все данные» + restore script + `docs/RESTORE.md`. Owner advised (not yet confirmed done): Neon
  paid plan (free keeps only 6 h of history), Render Starter ($7, free sleeps after 15 min), a password manager,
  2FA recovery codes, a weekly data download and a monthly ZIP of the code.

## Open items / decisions waiting for the owner
* FIXED 2026-10-16: «today»/rolling day boundaries now start at Almaty midnight (`common/zoned-day.ts`) — Sales summary, Network overview, Finance today, period comparisons, Telegram reports. (AI-центр buckets left as they were — module deferred.)
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
`main`. Customer Telegram bot BUILT (needs the owner to create it in @BotFather and put CUSTOMER_BOT_TOKEN on Render). Next: WhatsApp (needs the owner's
Meta business account + provider). Consent wording still awaits a lawyer.

## WhatsApp (2026-10-19)
Built and on `main`, inactive until the owner's Meta account is approved and the four `WHATSAPP_*` env vars are set on
Render (see CLAUDE.md «WhatsApp»). Owner's steps: Meta Business account on the ИП + verification, a new SIM used only
for this (not in the WhatsApp app), payment card in Meta, a System User permanent token. Then: put the keys on Render,
paste Callback URL + Verify token from the programme card into Meta (subscribe `messages` and `user_preferences`),
press «Отправить шаблоны на проверку в Meta», wait for approval, send one real test. Next after that: automatic
welcome / win-back messages, a «Мои баллы» page for customers without Telegram.
