const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

// Opens the video page; `scale` > 1 renders it larger than 1920 × 1080 (for supersampling).
// `only` = a scene id: just that scene is loaded (its own time starts at its `start`).
// A page with only the given files (paths relative to src/), for building one mock or scene alone:
//   harness("ios", { css: ["mocks/ios-install.css"], js: ["mocks/ios-install.js", "mocks/_demo-ios-install.js"] })
exports.harness = (key, { css = [], js = [] }) => {
  const src = path.join(__dirname, "..", "src");
  const base = fs.readFileSync(path.join(src, "index.html"), "utf8");
  const html = base
    .replace(/<!-- css -->[\s\S]*?<!-- \/css -->/, css.map((f) => `<link rel="stylesheet" href="${f}">`).join("\n"))
    .replace(/<!-- js -->[\s\S]*?<!-- \/js -->/, js.map((f) => `<script src="${f}"></script>`).join("\n"));
  const name = `_h.${key}.html`;
  fs.writeFileSync(path.join(src, name), html);
  return name;
};

exports.openPage = async ({ scale = 1, html = "index.html" } = {}) => {
  const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text"] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("requestfailed", (r) => errors.push("failed to load " + r.url()));
  await page.goto("file://" + path.join(__dirname, "..", "src", html));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const duration = await page.evaluate(() => window.__duration);
  return { browser, page, duration, errors };
};
exports.OUT = path.join(__dirname, "..", "out");
exports.mkdir = (d) => fs.mkdirSync(d, { recursive: true });
