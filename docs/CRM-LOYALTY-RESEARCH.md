# CRM + loyalty programme + WhatsApp — research (2026-10-15)

Status: RESEARCH ONLY. No code, no schema, nothing decided. Written for the owner (non-developer) and for the
next session. Where a claim comes from a vendor's own marketing or a third-party blog it is marked **(vendor)** or
**(unverified)**. Prices and rules change; re-check on the provider's own pages before any commitment.

## 1. What «Sagi» actually is (the example the owner likes)
Sagi is a Kazakhstan-born loyalty-marketing platform for small and medium businesses (founded 2021; 500+
businesses and 1M+ end customers in Russia, Kazakhstan, Kyrgyzstan — per
[The Tech KZ](https://the-tech.kz/sagi-startap-kotoryj-pomogaet-biznesam-uvelichivat-klientskuyu-bazu-i-uderzhivat-klientov), 2024). Its site is now
[sagibonus.com](https://sagibonus.com). Features listed there **(vendor)**:
* **15+ bonus types**: cashback, gifts, tiers, birthdays, referrals.
* **Wallet card** (loyalty card in the phone).
* **WhatsApp**: automatic notifications and segment campaigns. Two modes: «gray» (quick start without the official
  API) and **WABA** (official WhatsApp Business API, only in the PRO package).
* **Analytics**: RFM (who is active / at risk / asleep), tags, cohorts, a «churn radar».
* **Capture** of customers from WhatsApp, Instagram, calls and walk-ins with a welcome bonus; **aggregators**
  (QR/promo code in Wolt, Glovo, Kaspi orders pulls the customer into your own base).
* **Cross-marketing** with neighbouring businesses.
* **Staff control** (transparency over cashiers' transactions).
* **POS/CRM integrations**: Poster, iiko, R-Keeper, 1C, Bitrix24, amoCRM (compatibility to be confirmed with a manager).
* Pricing: by locations and modules, 1/3/6/12-month terms with discounts; no public price list.
Note: the «gray» WhatsApp mode is unofficial (a normal number driven by software); it risks the number being blocked.
Not recommended for a business channel.

## 2. The landscape (so we do not copy one product blindly)
| Group | Examples | Fit for a bakery network |
|---|---|---|
| Local / CIS loyalty platforms | Sagi, Maxma (cashback, referral, virtual cards, SMS/e-mail, segmentation) | closest to our market; paid monthly |
| Global SMB loyalty | Square Loyalty (about $45/month per location, deep POS tie-in), Stamp Me (digital stamp cards for cafés/bakeries) | good ideas, POS-locked |
| Enterprise | Punchh, Paytronix, Antavo, Open Loyalty | built for big chains; long, costly implementations |
| General CRM | Bitrix24 (leader in Kazakhstan: 40.4 % of automation systems per [The Tech KZ](https://the-tech.kz/bitriks24-stal-liderom-crm-rynka-kazahstana-s-dolej-404/)), amoCRM | sales pipelines/leads, not a shop loyalty engine |
Sources for the global rows are review sites with affiliate interests; treat as a shortlist, not a verdict.

## 3. What every serious loyalty/CRM product has (common sections)
1. **Customer base**: card/phone identity, profile, consent record, purchase history, merged duplicates.
2. **Reward mechanics**: points/cashback (earn % per purchase), spend-to-redeem, **tiers** (higher earn rate), **stamp
   cards** («buy 10, 11th free»), fixed gifts, **birthday** reward, **referral** reward, welcome bonus, expiry of points.
3. **At the till**: look up by phone/QR, show balance, apply/redeem, return reverses the bonus, anti-fraud limits.
4. **Wallet/digital card**: Apple/Google Wallet pass or a mobile page (vendor claims of +frequency exist, e.g. Brevo's
   Jacadi case +39 % purchase frequency — **vendor**, no method given).
5. **Segmentation & analytics**: RFM (recency/frequency/monetary), «sleeping»/«at risk» lists, cohorts, repeat-purchase rate.
6. **Messaging & automation**: welcome, «you are N stamps from a gift», birthday, win-back («we have not seen you»),
   campaigns to a segment; templates; send windows; unsubscribe.
7. **Control & safety**: roles, audit log, limits on manual bonus changes, fraud/abuse detection.
8. **Integrations**: POS, accounting, messengers, aggregators.

## 4. WhatsApp channel — what we can verify
* The official route is the **WhatsApp Business Platform (Cloud API)** via Meta, normally through a **BSP** (a
  provider that hosts the connection and charges its own fee). Requirements: a business account, a dedicated phone
  number, approved **message templates** for anything sent outside a 24-hour window, and customer **opt-in**.
* **Price model**: since 1 July 2025 charged **per delivered template message**, by category (marketing / utility /
  authentication) and the recipient's country; replies inside a customer-initiated 24 h window were free
  ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
* **Kazakhstan** became its own rate line from **1 Oct 2026**. Third-party reports give, in USD per message:
  marketing ≈ **$0.0604** (≈ 27 ₸), utility/authentication ≈ **$0.018** (≈ 8 ₸), service replies beyond
  1 000 free per number per month ≈ $0.018 ([Lada.kz citing GoFlow](https://www.lada.kz/kazakhstan-news/158549-s-1-oktiabria-whatsapp-vvodit-platu-za-soobshcheniia-v-kazakhstane.html);
  [Courier](https://www.courier.com/blog/whatsapp-pricing-changes-october-2026)). **Meta's own page does not list the
  Kazakhstan numbers or the service-message change — sources disagree. Treat every figure as unverified until the
  provider's rate card (billed in USD) is in hand.**
* **Example budget (unverified)**: 5 000 marketing messages a month ≈ $300 ≈ 135 000 ₸ + the provider's monthly fee. So
  marketing blasts must be targeted (a segment, not the whole base); utility messages (bonus earned, order ready) cost ~⅓.
* Free routes: a customer who writes first (24 h window) and **Click-to-WhatsApp ad** conversations (72 h free).
* We have **no** provider account, credentials or a verified business number. Per CLAUDE.md the Интеграции module is
  deferred until real credentials exist; the owner would need to choose a BSP and open the account.
* Telegram (already built, free) is a cheaper first channel for people who use it; WhatsApp is the main one in the
  owner's city, so it must be in the plan — but as a later phase.

## 5. Legal (Kazakhstan) — needs a lawyer before launch
* Basic law: «О персональных данных и их защите» (No. 94-V of 21.05.2013); 2026 amendments (in force from
  11.07.2026) changed the definition of personal data and introduce a register of data operators
  ([Morgan Lewis](https://www.morganlewis.com/ru/pubs/2026/07/republic-of-kazakhstan-data-protection-law-amendments-in-2026)).
* Practical rule from legal reviews: consent must be explicit, recorded (who, when, for what) — «by continuing you
  agree» does not work. Our design must store the consent per customer and per channel, and honour withdrawal.
* Unclear from public sources: specific rules for advertising messages via WhatsApp (opt-out wording, timing).
  Verify on adilet.zan.kz and with a Kazakh lawyer. Meta's own policy independently requires opt-in.

## 6. One platform or separate? (recommendation)
**Inside ArAmir OS, as a separate module («CRM и бонусы») with clean boundaries.**
* Bonuses are earned and spent **at the till** (POS), reversed on returns, and must not touch revenue/COGS.
  A separate product would need two-way sync of sales, returns and customers — the source of most failures.
* Already in the platform: `Customer` (name, phone, credit limit, only wholesale-style), POS, `Promotion`/coupons by
  category (cashier types a code; one-use enforcement), the Telegram bot (account linking, pushes), audit log, roles.
* Keep the module loosely coupled: it listens to «sale completed / return created» and owns its own tables; messaging
  goes through one outbound queue with provider adapters (Telegram now, WhatsApp BSP later). That keeps the option to
  move it out later.
* Buy-vs-build: a vendor (Sagi, Maxma) is faster to a first launch but is a second customer database, a monthly fee per
  location, and the POS tie-in (iiko/Poster/1C — **not** ArAmir OS) is not available for our own POS. Building inside
  keeps data, bonuses and analytics in one place.

## 7. Proposed phases (no commitment)
0. **Decisions** (owner): reward model (points/cashback vs stamps vs tiers), earning %, expiry, what counts as a «member».
1. **Customer identity at the till**: retail customer by phone, consent record, merge duplicates, import.
2. **Bonus engine**: earn/spend/expire as an append-only ledger (like stock/cash: never edit, add an adjustment), reversal
   on returns, limits, audit. Excluded from revenue; accounted as a liability only if the owner/accountant decides (D-type
   decision, not defaulted).
3. **Till UI**: phone lookup, balance, redeem, receipt line; wallet/mobile card page.
4. **Segments & analytics**: RFM, sleeping/at-risk lists, repeat rate, cohort view.
5. **Messaging**: Telegram first (free), then WhatsApp via a chosen BSP with approved templates; automations (welcome,
   birthday, win-back, stamp progress); consent and unsubscribe enforced centrally.
6. Later: referral, tiers, cross-marketing, aggregator capture, wallet passes.

## 8. Risks
* WhatsApp costs/rules change quarterly; unofficial «gray» WhatsApp can get numbers blocked.
* Consent/legal handling (needs a lawyer). * Bonus abuse (fake phones, cashier self-crediting) — limits + audit.
* Accounting treatment of unredeemed bonuses (liability) — an unapproved policy, never defaulted.
* Scope: this is a large product; phase 1–3 alone is a feature the size of the ledger work.

## 9. Open questions for the owner
Reward model preference; what Sagi features are actually used/liked (screenshots optional); how many retail customers
identify themselves today; WhatsApp: which provider/number; who owns consent wording; budget per month for messages.

## 10. Owner decisions so far (2026-10-15)
* **Reward model: accumulate points and pay part of a check with them** (chosen by the owner).
* **Earning rate, as the owner stated it:** **5% on a customer's FIRST purchase**, afterwards **1%** ("рассматривают" —
  the 1% is still being considered, not final). Read as: one-time 5% welcome accrual on the first purchase, then a
  standing rate of 1% (make the rate a setting, not a constant, so 1% can change without a release).
* Still NOT decided (never default): max share of a check payable with points (30% was only a proposal), expiry
  (12 months proposed), whether consignment / marked-down goods / the part paid by points earn points (proposed: no),
  accounting treatment of issued/redeemed points (owner + accountant), WhatsApp provider and budget.
* Build order agreed: phase 1 (customer by phone + consent record) → phase 2 (points ledger, append-only) → phase 3
  (till UI). Messaging (WhatsApp) comes after, and needs the owner's own Meta business account.
* Vendor option (Sagi) stays open in parallel; it is only viable if Sagi gives API access for a custom POS.

## 11. Stage 1 — built (2026-10-15, branch `claude/loyalty-phase1`, not yet on `main`)
* Retail customer by phone (`LoyaltyMember`, separate from wholesale `Customer`), Kazakhstan numbers normalized
  to `+77XXXXXXXXX`, duplicates refused, one-way merge of duplicates, CSV import (preview, then add only new).
* Append-only consent record: personal data + advertising per channel (WhatsApp/Telegram/SMS), who/when/how,
  withdrawal honoured (withdrawing personal-data consent closes every channel and the membership).
* Till: «Клиент» button finds/registers a customer and records consent; it does not attach them to the sale yet.
* Open for a lawyer (not decided in code): whether a verbal consent at the till is enough (source «На кассе» is
  recorded as such), the consent wording/version, and what «delete my data» must do (today: withdrawal keeps
  the record and its history as proof; nothing is erased).
* Still waiting for the owner before stage 2: max share of a check payable with points, expiry, exclusions,
  accounting treatment. Earning rates 5 % / 1 % will be settings.

## 12. Stage 2 + till — built (2026-10-16)
* Owner decisions (2026-10-16): max 30 % of a check payable with points; points live 12 months; no points on
  consignment goods, markdowns (and coupon lines) or the part paid by points; all percentages and the lifetime
  are settings. Accounting: **«способ Б» — spending points is a discount** (revenue = money actually paid; points
  appear in the P&L discounts line; issued points are not booked as a liability, the amount on hand is shown on
  the loyalty screen). The МСФО 15 deferred-revenue method stays possible later; the full points history is kept.
* Till: the cashier attaches a member to the cart by phone, sees the balance and can pay up to the limit with
  points; the slip shows points spent/earned. Returns give back spent points and take back earned ones.
* Settings card + figures (points on hand, earned, «Скидки баллами», expired) on Клиенты → Розница.
* Still not built: WhatsApp/Telegram messaging, birthday/referral bonuses, tiers, wallet card.
