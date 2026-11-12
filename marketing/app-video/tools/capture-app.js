// Captures the REAL customer app (ar-amir.com/app) for the video, with the API
// answered by invented demo data (no real customer is shown, nothing is written).
// Needs the web app running:  cd apps/web && ./node_modules/.bin/next start -p 3000
//   NODE_PATH=/opt/node22/lib/node_modules node tools/capture-app.js
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "assets", "app");
const BASE = process.env.APP_URL || "http://localhost:3000";
const W = 390;

const programme = {
  enabled: true, earnPercent: 2, maxRedeemPercent: 30, pointsLifetimeMonths: 12, welcomeBonusPoints: 5000, welcomeBonusDays: 10, birthdayBonusPoints: 0,
  tiers: { windowDays: 90, silver: { threshold: 30000, percent: 3 }, gold: { threshold: 75000, percent: 4 }, platinum: { threshold: 150000, percent: 5 } },
};
const info = { brand: "Ar Amir", ready: true, whatsapp: false, telegram: true, programme };
const now = new Date();
const ago = (h) => new Date(now.getTime() - h * 3600_000).toISOString();
const profile = (over = {}) => ({
  name: "Айгерим", phone: "+77011234567", memberSince: ago(2), balance: 5000, pending: null, expiring: null,
  card: { secret: "6b1f0a9c2d4e8f7061a3b5c7d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2" }, serverTime: now.toISOString(), visits: 1,
  tier: { tier: "BASE", percent: 2, spend: 3600, windowDays: 90, next: { tier: "SILVER", percent: 3, threshold: 30000, remaining: 26400 }, heldUntil: null },
  chatUnread: 0, programme,
  history: [{ id: "h1", at: ago(1), kind: "PURCHASE", title: "Покупка", place: "Ar Amir", amount: 3600, points: 5000 }],
  ...over,
});
const chat = { messages: [
  { id: "c1", at: ago(1), from: "BAKERY", kind: "NOTICE", title: "Спасибо за покупку!", text: "Начислено: +5 000 бонусов. Они станут доступны с завтрашнего дня.", byName: null, read: true },
  { id: "c2", at: ago(0.6), from: "CUSTOMER", kind: "TEXT", title: null, text: "Здравствуйте! Можно заказать торт на субботу?", byName: null, read: true },
  { id: "c3", at: ago(0.5), from: "BAKERY", kind: "TEXT", title: null, text: "Да, конечно! Какой вес и начинка?", byName: null, read: true },
] };

async function open(browser, { height, token, me, pending }) {
  const ctx = await browser.newContext({ viewport: { width: W, height }, deviceScaleFactor: 3, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await ctx.addInitScript(([token, pending]) => {
    try {
      localStorage.clear();
      if (token) localStorage.setItem("aa.club.token", token);
      if (pending) localStorage.setItem("aa.club.pending", pending);
      localStorage.setItem("aa.club.pushPromptHidden", "1");
      localStorage.setItem("aa.club.installHintHidden", "1");
    } catch {}
  }, [token ? "demo" : null, pending ? JSON.stringify(pending) : null]);
  const page = await ctx.newPage();
  await page.route("**/club/**", (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (url.endsWith("/club/info")) return json(info);
    if (url.endsWith("/club/me")) return json(me || profile());
    if (url.endsWith("/club/chat")) return json(chat);
    if (url.endsWith("/club/push/key")) return json({ publicKey: "x" });
    if (/\/club\/login\/[^/]+\/status$/.test(url)) return json({ status: "PENDING" });
    return json({});
  });
  await page.goto(BASE + "/app", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // No entrance fade in a still.
  await page.addStyleTag({ content: ".aa-fade{animation:none!important} *{caret-color:transparent!important}" });
  await page.waitForTimeout(500);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();
  const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name + ".png"), ...opts });
  const H = Number(process.env.H || 797); // 844 minus a 47px status bar drawn by the video

  // ── signed out ──
  {
    const { ctx, page } = await open(browser, { height: H });
    await page.waitForSelector("#aa-phone");
    await shot(page, "login-empty");
    await page.fill("#aa-phone", "7011234567");
    await shot(page, "login-phone");
    await page.fill("#aa-name", "Айгерим");
    await page.locator(".aa-check input").first().check();
    await page.waitForTimeout(600); // the button's own fade from "disabled"
    await shot(page, "login-filled");
    await ctx.close();
  }
  {
    const pending = { requestId: "r1", secret: "s", code: "482913", expiresAt: new Date(now.getTime() + 9 * 60_000).toISOString(), whatsappUrl: null, telegramUrl: "https://t.me/", phone: "+77011234567" };
    const { ctx, page } = await open(browser, { height: H, pending });
    await page.waitForSelector(".aa-bigcode");
    await shot(page, "login-confirm");
    await ctx.close();
  }

  // ── signed in ──
  for (const [name, me] of [["card", profile()], ["card-zero", profile({ balance: 0, history: [], visits: 0, tier: { tier: "BASE", percent: 2, spend: 0, windowDays: 90, next: { tier: "SILVER", percent: 3, threshold: 30000, remaining: 30000 }, heldUntil: null } })]]) {
    const { ctx, page } = await open(browser, { height: H, token: true, me });
    await page.waitForSelector(".aa-tabs");
    await shot(page, name);
    // The whole page without the floating tab bar (for scrolling inside the phone), and the bar alone.
    const bar = await page.locator(".aa-tabs").boundingBox();
    if (name === "card") await shot(page, "tabbar", { clip: { x: 0, y: bar.y - 14, width: W, height: H - bar.y + 14 }, omitBackground: false });
    await page.addStyleTag({ content: ".aa-tabs{display:none!important}" });
    await shot(page, name + "-full", { fullPage: true });
    // The card alone and the «Покажите кассиру» panel alone, for close-ups.
    if (name === "card") {
      const card = page.locator(".aa-card, [class*='aa-card']").first();
      if (await card.count()) await card.screenshot({ path: path.join(OUT, "card-only.png"), omitBackground: true });
    }
    await ctx.close();
  }
  for (const [tab, name] of [["История", "history"], ["Чат", "chat"], ["Профиль", "profile"]]) {
    const { ctx, page } = await open(browser, { height: H, token: true });
    await page.waitForSelector(".aa-tabs");
    await page.click(`.aa-tab:has-text("${tab}")`);
    await page.waitForTimeout(700);
    await shot(page, name);
    await ctx.close();
  }
  await browser.close();
  console.log("captured to", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
