// The whole video:  node tools/render.js [--out out/ar-amir-app.mp4] [--scale 2] [--from 0] [--to <end>] [--crf 15]
// Every frame is seek + screenshot, piped straight into ffmpeg (H.264, yuv420p, bt709).
//   --scale 2 (default): drawn at 3840 × 2160 and scaled down — the final quality (~0.2 s a frame).
//   --scale 1: drawn at 1920 × 1080, lossless and quick (~0.08 s a frame) — for drafts.
const path = require("path");
const { spawn } = require("child_process");
const { openPage, OUT, mkdir } = require("./lib");
(async () => {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
  const scale = Number(opt("scale", 2));
  const { browser, page, duration, errors } = await openPage({ scale });
  const fps = await page.evaluate(() => V.cfg.fps);
  const from = Number(opt("from", 0));
  const to = Number(opt("to", duration));
  const out = path.resolve(opt("out", path.join(OUT, "ar-amir-app.mp4")));
  mkdir(path.dirname(out));
  const total = Math.round((to - from) * fps);
  const draft = scale === 1;
  const cdp = draft ? await page.context().newCDPSession(page) : null;
  const grab = draft
    ? async () => Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).data, "base64")
    : () => page.screenshot({ type: "jpeg", quality: 97 });
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", draft ? "png" : "mjpeg", "-i", "-",
    "-vf", "scale=1920:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", String(opt("crf", 15)), "-profile:v", "high", "-level", "4.1",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-an", "-r", String(fps), out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exit " + c)))));
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.__seek(t), from + i / fps);
    const buf = await grab();
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 90 === 0) process.stdout.write(`\rframe ${i}/${total}`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  console.log(`\rrendered ${total} frames (${(to - from).toFixed(2)} s) in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${out}`);
  if (errors.length) { console.error("PAGE ERRORS:\n" + errors.join("\n")); process.exit(2); }
})().catch((e) => { console.error(e); process.exit(1); });
