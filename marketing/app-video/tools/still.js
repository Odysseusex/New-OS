// Stills at the given seconds:  node tools/still.js 0 2.5 7.25 [--dir out/stills] [--scale 1] [--prefix name]
//   --every 0.5 [--from 0 --to 12]   a still every N seconds over a range
//   --only key --js a.js,b.js [--css a.css,b.css]   a page with ONLY these files (relative to src/)
//   --zoom x,y,w,h   crop every still to this rectangle of the 1920 × 1080 frame (to look closely)
const path = require("path");
const { openPage, harness, OUT, mkdir } = require("./lib");
(async () => {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf("--" + k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const dir = path.resolve(opt("dir", path.join(OUT, "stills")));
  const scale = Number(opt("scale", 1));
  const prefix = opt("prefix", "t");
  const every = opt("every", null);
  const from = Number(opt("from", 0));
  const toArg = opt("to", null);
  const only = opt("only", null);
  const js = opt("js", "");
  const css = opt("css", "");
  const zoom = opt("zoom", null);
  const html = only ? harness(only, { js: js.split(",").filter(Boolean), css: css.split(",").filter(Boolean) }) : "index.html";
  const { browser, page, duration, errors } = await openPage({ scale, html });
  let times = argv.map(Number).filter((n) => !Number.isNaN(n));
  if (every) { times = []; const to = toArg === null ? duration : Number(toArg); for (let t = from; t <= to + 1e-6; t += Number(every)) times.push(Math.min(Math.round(t * 1000) / 1000, duration - 0.001)); }
  mkdir(dir);
  for (const t of times) {
    await page.evaluate((t) => window.__seek(t), t);
    const file = path.join(dir, `${prefix}-${t.toFixed(2).padStart(6, "0")}.png`);
    const clip = zoom ? (([x, y, width, height]) => ({ x, y, width, height }))(zoom.split(",").map(Number)) : undefined;
    await page.screenshot({ path: file, clip });
    console.log(file);
  }
  if (errors.length) console.error("PAGE ERRORS:\n" + errors.join("\n"));
  await browser.close();
  if (errors.length) process.exit(2);
})().catch((e) => { console.error(e); process.exit(1); });
