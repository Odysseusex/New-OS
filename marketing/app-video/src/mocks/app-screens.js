// MOCKS: the real app, from its screenshots (assets/app) — signing in, and the signed-in card screen.
//
//   const login = V.mocks.appLogin(phone);
//   let t = login.steps.show(tl, 0);                // 0.4 s  the empty sign-in screen ({ filled: true } = already filled in)
//   t = login.steps.typeNumber(tl, t + 0.6);        // 2.5 s  ring on the number field, a touch, ten digits typed
//   t = login.steps.fillRest(tl, t + 0.5);          // 3.55 s the name typed, then ring + touch on the consent box
//   t = login.steps.tapContinue(tl, t + 0.6);       // 1.6 s  ring on «Продолжить», a touch → «Отправьте нам одно сообщение»
//   t = login.steps.tapOpenTelegram(tl, t + 0.8);   // 1.35 s ring on «Открыть Telegram», a touch; the screen stays
//   t = login.steps.hide(tl, t);                    // 0.3 s
//
//   const card = V.mocks.appCard(phone);
//   t = card.steps.show(tl, t, { balance: "zero" }); // 0.5 s  "zero" | "full" (default)
//   t = card.steps.addBonus(tl, t + 0.7);           // 1.2 s  0 → 5 000, the card pulses, «+5 000 бонусов» rises
//   t = card.steps.scrollToQr(tl, t + 0.7);         // 0.9 s  «Покажите кассиру» centred
//   t = card.steps.scan(tl, t + 0.5);               // 1.6 s  a line of light over the code, then one ring
//   t = card.steps.scrollToTop(tl, t + 0.6);        // 0.8 s
//   t = card.steps.hide(tl, t + 0.6);               // 0.3 s
//
// Every step adds its tweens to `tl` at `at` and returns the time it ends. In a tap step the gold ring
// fades in for 0.5 s from `at` and the touch starts at `at + 0.7`.
// anchors: rectangles in the phone's own points (origin: top-left of .phone-screen, 390 × 844).
(function () {
  const V = window.V;
  V.mocks = V.mocks || {};
  const TOP = 47;   // the screenshots live in the 390 × 797 area under the status bar
  const LEAD = 0.7; // ring first, then the touch

  const add = (parent, el) => (parent.appendChild(el), el);
  const box = (r, pad = 0) => `left:${r.x - pad}px;top:${r.y - pad}px;width:${r.w + 2 * pad}px;height:${r.h + 2 * pad}px`;
  const onScreen = (r) => ({ x: r.x, y: r.y + TOP, w: r.w, h: r.h });
  // A window onto rectangle `r` of screenshot `name`, sitting exactly where that rectangle is.
  const crop = (name, r, cls = "") => {
    const el = V.h(`<div class="m-app-crop ${cls}" style="${box(r)}"></div>`);
    const img = add(el, V.shot(name));
    img.style.left = -r.x + "px";
    img.style.top = -r.y + "px";
    return el;
  };
  const ring = (r, pad, radius) => V.h(`<div class="m-app-ring" style="${box(r, pad)};border-radius:${radius + pad}px"></div>`);
  const ringIn = (tl, el, at) => tl.to(el, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "power2.out" }, at);
  const ringOut = (tl, el, at) => tl.to(el, { autoAlpha: 0, duration: 0.2, ease: "power1.out" }, at);

  // ── signing in ─────────────────────────────────────────────────────────
  // Rectangles in the screenshots' own points (the 3× PNGs measured, ÷ 3).
  const L = {
    phone: { x: 35, y: 332, w: 320, h: 54 },
    name: { x: 35, y: 428, w: 320, h: 54 },
    check: { x: 35, y: 498, w: 22, h: 22 },
    go: { x: 35, y: 573, w: 320, h: 56 },
    tg: { x: 35, y: 418, w: 320, h: 56 },
    code: { x: 103, y: 568, w: 176, h: 41 },
    phoneText: { x: 72, y: 348, w: 108, h: 22 }, // the ten digits after «+7»
    nameText: { x: 50, y: 444, w: 74, h: 24 },
  };
  // Right edge of every typed glyph: «701 123 45 67» and «Айгерим».
  const DIGIT_ENDS = [246, 275, 293, 323, 355, 382, 422, 450, 491, 517].map((px) => px / 3);
  const LETTER_ENDS = [186, 211, 235, 263, 291, 317, 350].map((px) => px / 3);
  const DIGIT_GAPS = [0.09, 0.09, 0.17, 0.09, 0.09, 0.17, 0.09, 0.17, 0.09]; // 701 · 123 · 45 · 67 — 1.05 s
  const LETTER_GAPS = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1];                        // 0.6 s

  V.mocks.appLogin = function (phone) {
    const screen = phone.querySelector(".phone-screen");
    const root = V.h(`<div class="m-app layer"><div class="m-app-view">
      <div class="m-app-pane js-form"></div>
      <div class="m-app-pane m-app-pane--push js-confirm"></div>
    </div></div>`);
    const form = root.querySelector(".js-form");
    const confirm = root.querySelector(".js-confirm");

    // A field: a patch that wipes the placeholder, a window that uncovers the typed text, a caret, the focus.
    const field = (r, text, shot) => {
      const mid = r.y + r.h / 2;
      return {
        blank: add(form, V.h(`<div class="m-app-blank" style="${box(text)}"></div>`)),
        typed: add(form, crop(shot, text)),
        caret: add(form, V.h(`<div class="m-app-caret" style="top:${mid - 12}px"></div>`)),
        focus: add(form, V.h(`<div class="m-app-focus" style="${box(r)}"></div>`)),
        ring: add(form, ring(r, 4, 14)),
        left: text.x,
      };
    };
    // A button: a patch of the panel's colour and the button's own picture, shown only while it is pressed.
    const button = (pane, r, shot) => ({
      patch: add(pane, V.h(`<div class="m-app-patch" style="left:${r.x - 0.5}px;top:${r.y - 0.5}px;width:${r.w + 1}px;height:${r.h + 0.5}px"></div>`)),
      copy: add(pane, crop(shot, r, "m-app-btn")),
      ring: add(pane, ring(r, 4, 16)),
    });

    add(form, V.shot("login-empty"));
    const fPhone = field(L.phone, L.phoneText, "login-phone");
    const fName = field(L.name, L.nameText, "login-filled");
    const filled = add(form, V.shot("login-filled")); // consent ticked, the button awake
    const ringCheck = add(form, ring(L.check, 5, 7));
    const bGo = button(form, L.go, "login-filled");
    add(confirm, V.shot("login-confirm"));
    const bTg = button(confirm, L.tg, "login-confirm");

    screen.appendChild(root);
    gsap.set(root, { autoAlpha: 0 });
    for (const f of [fPhone, fName]) {
      gsap.set([f.blank, f.caret, f.focus], { autoAlpha: 0 });
      gsap.set(f.typed, { width: 0 });
      gsap.set(f.ring, { autoAlpha: 0, scale: 1.03 });
    }
    gsap.set(fPhone.caret, { x: 73.4 });
    gsap.set(fName.caret, { x: 51.4 });
    gsap.set(filled, { autoAlpha: 0 });
    gsap.set(ringCheck, { autoAlpha: 0, scale: 1.3 });
    for (const b of [bGo, bTg]) {
      gsap.set([b.patch, b.copy], { autoAlpha: 0 });
      gsap.set(b.ring, { autoAlpha: 0, scale: 1.03 });
    }
    gsap.set(confirm, { autoAlpha: 0, x: 390 });

    // The cursor lands in a field ~0.25 s into the touch.
    const focusIn = (tl, f, at) => tl.to(f.focus, { autoAlpha: 1, duration: 0.15, ease: "power1.out" }, at).set(f.caret, { autoAlpha: 1 }, at + 0.05);
    const focusOut = (tl, f, at) => tl.to(f.focus, { autoAlpha: 0, duration: 0.15, ease: "power1.out" }, at).set(f.caret, { autoAlpha: 0 }, at);
    // One glyph per step: the placeholder goes with the first one, the caret follows the last.
    const type = (tl, f, ends, gaps, at) => {
      let t = at;
      tl.set(f.blank, { autoAlpha: 1 }, t);
      ends.forEach((end, i) => {
        tl.set(f.typed, { width: end + 0.7 - f.left }, t).set(f.caret, { x: end + 1 }, t);
        if (i < gaps.length) t += gaps[i];
      });
      return t;
    };
    // The button sinks ~0.22 s into the touch and comes back.
    const press = (tl, b, tp) =>
      tl.set([b.patch, b.copy], { autoAlpha: 1 }, tp + 0.2)
        .to(b.copy, { scale: 0.972, duration: 0.12, ease: "power1.in" }, tp + 0.22)
        .to(b.copy, { scale: 1, duration: 0.18, ease: "power1.out" }, tp + 0.38)
        .set([b.patch, b.copy], { autoAlpha: 0 }, tp + 0.58);

    return {
      root,
      anchors: {
        phoneField: onScreen(L.phone),
        nameField: onScreen(L.name),
        consent: onScreen(L.check),
        consentRow: { x: 35, y: 498 + TOP, w: 320, h: 62 },
        continueButton: onScreen(L.go),
        telegramButton: onScreen(L.tg),
        code: onScreen(L.code),
      },
      steps: {
        // The empty sign-in screen. { filled: true } shows it already filled in (number, name, consent),
        // for a scene that goes straight to tapContinue.
        show(tl, at, { filled: ready = false } = {}) {
          if (ready) tl.set(filled, { autoAlpha: 1 }, at);
          tl.to(root, { autoAlpha: 1, duration: 0.4, ease: "power1.out" }, at);
          return at + 0.4;
        },
        hide(tl, at) {
          tl.to(root, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, at);
          return at + 0.3;
        },
        // Ring on the number field → a touch → the cursor → «701 123 45 67», a digit at a time.
        typeNumber(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, fPhone.ring, at);
          V.tap(tl, screen, 262, L.phone.y + 27 + TOP, tp);
          ringOut(tl, fPhone.ring, tp + 0.25);
          focusIn(tl, fPhone, tp + 0.25);
          return type(tl, fPhone, DIGIT_ENDS, DIGIT_GAPS, tp + 0.55) + 0.2;
        },
        // The name the same way, then ring + touch on the consent box: it ticks and «Продолжить» wakes up.
        // From then on the form is exactly the screenshot login-filled.
        fillRest(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, fName.ring, at);
          V.tap(tl, screen, 262, L.name.y + 27 + TOP, tp);
          ringOut(tl, fName.ring, tp + 0.25);
          focusOut(tl, fPhone, tp + 0.25);
          focusIn(tl, fName, tp + 0.25);
          const typedAt = type(tl, fName, LETTER_ENDS, LETTER_GAPS, tp + 0.55);
          const ringAt = typedAt + 0.35, tp2 = ringAt + LEAD;
          ringIn(tl, ringCheck, ringAt);
          V.tap(tl, screen, L.check.x + 11, L.check.y + 11 + TOP, tp2);
          focusOut(tl, fName, tp2 + 0.25);
          tl.to(filled, { autoAlpha: 1, duration: 0.2, ease: "power1.out" }, tp2 + 0.25);
          ringOut(tl, ringCheck, tp2 + 0.45);
          return tp2 + 0.65;
        },
        // Ring on «Продолжить» → a touch → the confirmation screen comes in from the right.
        tapContinue(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, bGo.ring, at);
          V.tap(tl, screen, 292, L.go.y + 30 + TOP, tp);
          press(tl, bGo, tp);
          ringOut(tl, bGo.ring, tp + 0.4);
          tl.set(confirm, { autoAlpha: 1 }, tp + 0.45)
            .to(confirm, { x: 0, duration: 0.45, ease: "power3.out" }, tp + 0.45)
            .to(form, { x: -72, autoAlpha: 0, duration: 0.4, ease: "power2.out" }, tp + 0.45);
          return tp + 0.9;
        },
        // Ring on «Открыть Telegram» → a touch. The screen stays: the scene brings Telegram on top.
        tapOpenTelegram(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, bTg.ring, at);
          V.tap(tl, screen, 306, L.tg.y + 30 + TOP, tp);
          press(tl, bTg, tp);
          ringOut(tl, bTg.ring, tp + 0.45);
          return tp + 0.65;
        },
      },
    };
  };

  // ── the card screen ────────────────────────────────────────────────────
  // Rectangles on the whole page (card-full / card-zero-full, 390 × 1173).
  const C = {
    card: { x: 16, y: 76, w: 358, h: 226 },
    balance: { x: 36, y: 203, w: 184, h: 46 },   // «5 000 бонусов»
    level: { x: 16, y: 320, w: 358, h: 143 },
    levelHead: 345,                              // top of its heading row
    qrPanel: { x: 16, y: 481, w: 358, h: 436 },  // «Покажите кассиру»
    qr: { x: 74, y: 531, w: 242, h: 242 },       // the white tile with the code
  };
  const VIEW_H = 797, TABS_H = 64;

  // opts.lift: how far the tab bar sits above its place in the screenshots (bottom 12 pt), so that
  // the phone's home indicator stays clear of it — as the safe area does on a real phone.
  V.mocks.appCard = function (phone, opts = {}) {
    const screen = phone.querySelector(".phone-screen");
    const lift = opts.lift === undefined ? 10 : opts.lift;
    const tabsTop = VIEW_H - 12 - lift - TABS_H;
    // «Покажите кассиру» centred between the status bar and the tab bar — but the edge of the status bar
    // must not come closer than 8 pt to the heading of the panel above («Ваш уровень», at 345).
    const qrScroll = Math.min(Math.round(C.qrPanel.y - (tabsTop - C.qrPanel.h) / 2), C.levelHead - 8);
    const bonus = "+" + V.fmt(V.cfg.welcomeBonus);

    const root = V.h(`<div class="m-app layer"><div class="m-app-view">
      <div class="m-app-rise"><div class="m-app-scroll"></div></div>
      <div class="m-app-fade" style="top:${tabsTop + TABS_H / 2}px;height:${TABS_H / 2}px"></div>
      <div class="m-app-frost" style="top:${tabsTop}px"><div><div style="top:${40 - tabsTop}px"></div></div></div>
      <div class="m-app-tabs" style="top:${tabsTop}px"><i></i></div>
      <div class="m-app-tabsink" style="top:${tabsTop + 1}px"></div>
    </div></div>`);
    const rise = root.querySelector(".m-app-rise");
    const scroll = root.querySelector(".m-app-scroll");
    add(scroll, V.shot("card-zero-full"));
    const pageFull = add(scroll, V.shot("card-full"));
    const copy = add(scroll, crop("card-zero-full", C.card, "m-app-cardcopy"));
    const copyFull = add(copy, V.shot("card-full"));
    copyFull.style.left = -C.card.x + "px";
    copyFull.style.top = -C.card.y + "px";
    const beam = add(add(scroll, V.h(`<div class="m-app-scan"></div>`)), V.h(`<div class="m-app-beam"><b></b><i></i></div>`));
    const pulse = add(scroll, V.h(`<div class="m-app-pulse"></div>`));
    const chip = add(scroll, V.h(`<div class="m-app-chip"><b>${bonus}</b><span>бонусов</span></div>`));
    // The page once more, blurred, behind the tab bar: it scrolls with the real one.
    const frost = root.querySelector(".m-app-frost > div > div");
    add(frost, V.shot("card-zero-full"));
    const frostFull = add(frost, V.shot("card-full"));
    const pages = [scroll, frost];
    const fulls = [pageFull, copyFull, frostFull]; // the 5 000 version, wherever the page is drawn

    screen.appendChild(root);
    gsap.set(root, { autoAlpha: 0 });
    gsap.set(rise, { y: 24 });
    gsap.set([beam, pulse], { autoAlpha: 0 });
    gsap.set(chip, { autoAlpha: 0, xPercent: -50, y: 0, scale: 0.9 });

    return {
      root,
      anchors: {
        card: onScreen(C.card),
        balance: onScreen(C.balance),
        levelPanel: onScreen(C.level),
        qr: { x: C.qr.x, y: C.qr.y - qrScroll + TOP, w: C.qr.w, h: C.qr.h },                       // after scrollToQr
        qrPanel: { x: C.qrPanel.x, y: C.qrPanel.y - qrScroll + TOP, w: C.qrPanel.w, h: C.qrPanel.h }, // after scrollToQr
        tabbar: { x: 16, y: tabsTop + TOP, w: 358, h: TABS_H },
      },
      steps: {
        // The card screen: fades in while the page rises 24 pt. balance: "zero" (0 бонусов) | "full" (5 000).
        show(tl, at, { balance = "full" } = {}) {
          tl.set(fulls, { autoAlpha: balance === "zero" ? 0 : 1 }, at)
            .set(pages, { y: 0 }, at)
            .fromTo(rise, { y: 24 }, { y: 0, duration: 0.5, ease: "power3.out", immediateRender: false }, at)
            .to(root, { autoAlpha: 1, duration: 0.5, ease: "power1.out" }, at);
          return at + 0.5;
        },
        hide(tl, at) {
          tl.to(root, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, at);
          return at + 0.3;
        },
        // The page moves up until «Покажите кассиру» is whole and centred.
        scrollToQr(tl, at) {
          tl.to(pages, { y: -qrScroll, duration: 0.9, ease: "power2.inOut" }, at);
          return at + 0.9;
        },
        scrollToTop(tl, at) {
          tl.to(pages, { y: 0, duration: 0.8, ease: "power2.inOut" }, at);
          return at + 0.8;
        },
        // The till's scanner: a line of warm light goes down the code once, then the tile answers with one ring.
        scan(tl, at) {
          tl.fromTo(beam, { y: 5 }, { y: 232, duration: 0.9, ease: "power1.inOut", immediateRender: false }, at)
            .to(beam, { autoAlpha: 1, duration: 0.12, ease: "power1.out" }, at)
            .to(beam, { autoAlpha: 0, duration: 0.14, ease: "power1.in" }, at + 0.78)
            .to(pulse, { autoAlpha: 1, duration: 0.12, ease: "power1.out" }, at + 0.9)
            .fromTo(pulse, { scale: 1 }, { scale: 1.09, autoAlpha: 0, duration: 0.58, ease: "power2.out", immediateRender: false }, at + 1.02);
          return at + 1.6;
        },
        // 0 → 5 000 (the page must be showing balance "zero"): the card pulses once, the chip rises and goes.
        addBonus(tl, at) {
          tl.to(fulls, { autoAlpha: 1, duration: 0.5, ease: "power2.inOut" }, at)
            .to(copy, { scale: 1.03, duration: 0.28, ease: "power2.out" }, at)
            .to(copy, { scale: 1, duration: 0.42, ease: "power2.inOut" }, at + 0.28)
            .to(chip, { autoAlpha: 1, scale: 1, duration: 0.25, ease: "power2.out" }, at)
            .to(chip, { y: -106, duration: 1.2, ease: "sine.inOut" }, at)
            .to(chip, { autoAlpha: 0, duration: 0.4, ease: "power1.in" }, at + 0.8);
          return at + 1.2;
        },
      },
    };
  };
})();
