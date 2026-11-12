# Phone-screen mocks — the contract

A **mock** is one drawn (or screenshot-based) phone screen with its interaction, usable by any scene.
Read `src/ui.js`, `src/base.css`, `src/engine.js` and the worked example `src/mocks/camera-scan.{js,css}`
+ `src/mocks/_demo-camera-scan.js` before writing one — follow the example's shape exactly.

## Files (yours only — never edit shared files)
- `src/mocks/<name>.js` — registers `V.mocks.<camelName> = function (phone, opts) { … }`
- `src/mocks/<name>.css` — every class prefixed `.m-<short>-` (the example uses `.m-cam-`)
- `src/mocks/_demo-<name>.js` — a harness scene that plays every step once, slowly enough to inspect
Shared files (`src/base.css`, `src/ui.js`, `src/engine.js`, `src/index.html`, `src/config.js`, `tools/*`) are
off-limits: if you need something from them, say so in your final report instead of editing.

## Shape
```js
V.mocks.thing = function (phone /* element from V.phone() */, opts = {}) {
  const screen = phone.querySelector(".phone-screen"); // 390 × 844 pt, origin top-left; status bar = top 47 pt (stays above you, z-index 30)
  const root = V.h(`<div class="m-thing layer">…</div>`);
  screen.appendChild(root);
  gsap.set(root, { autoAlpha: 0 });                    // a mock is HIDDEN until its show() step
  return {
    root,
    anchors: { someButton: { x, y, w, h } },           // rectangles of the controls a scene may point at, in phone points
    steps: {
      show(tl, at) { …; return endTime; },             // mandatory
      hide(tl, at) { …; return endTime; },             // mandatory
      tapSomething(tl, at) { …; return endTime; },     // one step per user action / visible change
    },
  };
};
```
- Everything inside the phone is laid out in **phone points** (the phone is scaled as a whole by its `--s`).
- A step ONLY adds GSAP tweens / `tl.set()` to the given timeline at time `at` (seconds on that timeline)
  and returns the time at which it visually ends. Steps are called in order by a scene, with pauses it chooses.
- Several mocks may live in the same phone (appended later = on top); `show`/`hide` is how they hand over.

## Hard rules (the video is rendered by seeking a paused timeline, one frame at a time)
- **No** CSS `transition` / `animation` / `@keyframes`, **no** `setTimeout`/`requestAnimationFrame`, **no**
  `Date`/`Math.random`, **no** `tl.call()` / `onComplete` / `onStart` side effects. State changes are tweens or
  `tl.set()` so that ANY time can be rendered on its own, forwards or backwards.
- Initial states: set them at build time with `gsap.set(...)` and animate with `tl.to(...)`. A `from()` /
  `fromTo()` renders its start values immediately — fine for an element's first tween, but any later
  `from`/`fromTo` on the same element needs `immediateRender: false` (or use `tl.set` + `tl.to`).
- A user touch is `V.tap(tl, screen, x, y, at)` (x, y in phone points) — about 0.65 s long; the thing touched
  should visibly react ~0.25 s after `at` (press-in), and the screen should change ~0.45 s after `at`.
- Dark screens: `V.statusLight(tl, phone, at, true)` for a white status bar; switch back on leaving.
- Real app screens are `V.shot("<name>")` (390 pt wide images from `assets/app/`), placed inside `.phone-view`
  (the 390 × 797 area under the status bar) or cropped by a wrapper with `overflow: hidden`.
- The app's icon is `../assets/icon-192.png` (square, red; round its corners yourself). No other brand's logo
  may be drawn: placeholder apps on a home screen are plain rounded squares in quiet warm neutral tones.
- All visible text is Russian, with the EXACT labels given in your task. Font inside phone UI: `var(--sans)`.
- System colours are allowed inside a mock where the real system uses them (iOS blue `#007aff` for its text
  buttons, Telegram's blue, the camera's yellow) — but **no green anywhere**, and no red except the app icon.
- Motion: calm and precise. Sheets and dialogs ease with `power3.out` (0.35–0.5 s); no bounces except a small
  `back.out(1.6)` on something that "pops" (a new icon). Dimming behind a sheet/dialog: black at 0.25–0.4.

## Looking at your work (do this — do not judge from the code)
```bash
cd /home/user/New-OS/marketing/app-video
NODE_PATH=/opt/node22/lib/node_modules node tools/still.js --every 0.5 \
  --only <name> --css mocks/<name>.css --js mocks/<name>.js,mocks/_demo-<name>.js \
  --dir out/mock-<name> --zoom 600,0,720,1080
python3 tools/sheet.py out/mock-<name> out/mock-<name>.png --cols 6 --width 360   # then Read the PNG
```
`still.js` prints PAGE ERRORS (and exits 2) if a script throws or a file is missing. For a close look at one
moment render it alone at double size: `… still.js 2.4 --scale 2 --only … --zoom 600,0,720,1080 --dir out/mock-<name>-big`.
In the demo, place the phone like the example does (`left:740px; top:60px`, scale 1.1) so the zoom rectangle fits.
