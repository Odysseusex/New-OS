// MOCK: the bakery's Telegram bot asking for the customer's number — this is how sign-in is confirmed.
//   const tg = V.mocks.telegramLogin(phone);
//   let t = tg.steps.show(tl, 0);               // 0.3 s  the chat appears: the bot's card, «НАЧАТЬ» at the bottom
//   t = tg.steps.tapStart(tl, t + 0.8);         // 2.0 s  ring on «НАЧАТЬ», a touch → «/start», then the bot's request with its keyboard
//   t = tg.steps.tapSendNumber(tl, t + 0.8);    // 1.5 s  ring on «📱 Отправить мой номер», a touch → «Поделиться номером?»
//   t = tg.steps.tapShare(tl, t + 0.8);         // 2.4 s  ring on «Поделиться», a touch → the contact, then «Готово! …»
//   t = tg.steps.hide(tl, t + 0.8);             // 0.3 s  the chat fades away
// Every step adds its tweens to `tl` at `at` and returns the time it ends. In a tap step the gold ring
// fades in for 0.5 s from `at`, the touch starts at `at + 0.7`, the screen changes ~0.45 s after the touch.
// anchors: rectangles in the phone's own points (origin: top-left of .phone-screen, 390 × 844).
(function () {
  const V = window.V;
  V.mocks = V.mocks || {};

  const BLUE = "#3390ec", GREY = "#8d8882";
  const I = {
    back: `<svg class="m-tg-back" width="12" height="22" viewBox="0 0 12 22" fill="none"><path d="M10 2.500 2.200 11l7.800 8.500" stroke="${BLUE}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    more: `<svg class="m-tg-more" width="4" height="20" viewBox="0 0 4 20" fill="${GREY}"><circle cx="2" cy="3" r="1.8"/><circle cx="2" cy="10" r="1.8"/><circle cx="2" cy="17" r="1.8"/></svg>`,
    clip: `<svg class="m-tg-clip" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${GREY}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.440 11.050l-9.190 9.190a6 6 0 0 1-8.490-8.490l9.190-9.190a4 4 0 0 1 5.660 5.660l-9.200 9.190a2 2 0 0 1-2.830-2.830l8.490-8.480"/></svg>`,
    mic: `<svg class="m-tg-mic" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${GREY}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12.500" rx="3"/><path d="M5.200 11.200a6.800 6.800 0 0 0 13.600 0M12 18v3.600"/></svg>`,
    // The «📱» of the bot's button, drawn (the system emoji font is a blurry bitmap with stray colours).
    // `id` names its gradient: one per mock, so two of these chats on one page never share (or lose) it.
    phone: (id) => `<svg width="13" height="21" viewBox="0 0 13 21"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8cc8f8"/><stop offset="1" stop-color="#4a9be8"/></linearGradient></defs><rect width="13" height="21" rx="2.800" fill="#2c2a2e"/><rect x="1.500" y="2.900" width="10" height="14.200" rx="0.900" fill="url(#${id})"/><rect x="5" y="1.200" width="3" height="0.800" rx="0.400" fill="#77737c"/><circle cx="6.500" cy="19.050" r="0.850" fill="#77737c"/></svg>`,
    ticks: `<svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="${BLUE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5.400 4 8.400l6-7.200"/><path d="M7.700 7.700l.7.7 6-7.200"/></svg>`,
  };

  // Geometry, in phone points. Every bubble has a row placed where it stands at the very end; earlier the
  // rows are simply shifted down (`y`), so that the newest bubble always sits just above the bottom bar.
  const LEAD = 0.7;                                   // ring first, then the touch
  const PRESS = 0.24;                                 // after the touch starts: the control presses in and its ring lets go (gone before the screen changes at +0.45)
  const GAP = 8;                                      // between bubbles
  const H = { start: 36, ask: 78, contact: 58, done: 72 }; // bubble heights (checked against the rendered layout)
  const DONE_W = 278;                                 // the last bubble's width (its CSS width)
  const FLOOR = 746, FLOOR_KEYS = 684;                // where the newest bubble ends: above the field / above the field + keyboard
  const KEYS_DROP = 96, INPUT_DROP = 62;              // how far the keyboard / the field travel when the keyboard goes
  const top = {};
  top.done = FLOOR - H.done;
  top.contact = top.done - GAP - H.contact;
  top.ask = top.contact - GAP - H.ask;
  top.start = top.ask - GAP - H.start;
  const bottom = (k) => top[k] + H[k];
  const SHIFT = {
    start: FLOOR - bottom("start"),                   // «/start» alone, no keyboard yet
    askKeys: FLOOR_KEYS - bottom("ask"),              // + the bot's request, which comes with its keyboard
    contact: FLOOR - bottom("contact"),               // the contact sent, the keyboard gone
    done: 0,
  };
  const R = {
    start: { x: 10, y: 765, w: 370, h: 40 },          // «НАЧАТЬ»
    key: { x: 8, y: 756, w: 374, h: 48 },             // «📱 Отправить мой номер»
    share: { x: 201, y: 447, w: 128, h: 35 },         // «Поделиться»
  };
  const box = (r, radius) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-radius:${radius}px`;
  const mid = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  let made = 0;                                       // mocks built so far (for ids that must be unique on the page)

  V.mocks.telegramLogin = function (phone) {
    const screen = phone.querySelector(".phone-screen");
    const demo = V.cfg.demo;
    const meta = (out) => `<span class="m-tg-meta">9:41${out ? I.ticks : ""}</span>`;
    const root = V.h(`<div class="m-tg layer">
      <div class="m-tg-card">Бот бонусной программы Ar&nbsp;Amir</div>
      <div class="m-tg-thread">
        <div class="m-tg-row js-row-start" style="top:${top.start}px"><div class="m-tg-msg m-tg-msg--out">/start<i class="m-tg-sp"></i>${meta(true)}</div></div>
        <div class="m-tg-row js-row-ask" style="top:${top.ask}px"><div class="m-tg-msg m-tg-msg--in m-tg-msg--ask">Чтобы войти в приложение Ar&nbsp;Amir, нажмите кнопку ниже и&nbsp;отправьте свой номер.<i class="m-tg-sp"></i>${meta(false)}</div></div>
        <div class="m-tg-row js-row-contact" style="top:${top.contact}px"><div class="m-tg-msg m-tg-msg--out m-tg-contact">
          <span class="m-tg-cava">${demo.name.charAt(0)}</span>
          <span class="m-tg-cname">${demo.name}</span>
          <span class="m-tg-cphone">${demo.phone}</span>
          ${meta(true)}
        </div></div>
        <div class="m-tg-row js-row-done" style="top:${top.done}px"><div class="m-tg-msg m-tg-msg--in m-tg-msg--done">Готово! Вход подтверждён&nbsp;— вернитесь в&nbsp;приложение Ar&nbsp;Amir.${meta(false)}</div></div>
      </div>
      <div class="m-tg-head">
        ${I.back}
        <img class="m-tg-ava" src="../assets/icon-192.png" alt="">
        <div class="m-tg-title">${V.cfg.brand}</div>
        <div class="m-tg-sub">бот</div>
        ${I.more}
      </div>
      <div class="m-tg-start"><b>НАЧАТЬ</b></div>
      <div class="m-tg-input">${I.clip}<div class="m-tg-field">Сообщение</div>${I.mic}</div>
      <div class="m-tg-keys"><div class="m-tg-key">${I.phone("m-tg-scr-" + ++made)}<span>Отправить мой номер</span></div></div>
      <div class="m-tg-dim"></div>
      <div class="m-tg-dialog">
        <h4>Поделиться номером?</h4>
        <p>Бот узнает ваш номер телефона.</p>
        <div class="m-tg-btns"><span class="m-tg-btn">Отмена</span><span class="m-tg-btn m-tg-btn--ok">Поделиться</span></div>
      </div>
      <div class="m-tg-ring js-ring-start" style="${box(R.start, 12)}"></div>
      <div class="m-tg-ring js-ring-key" style="${box(R.key, 11)}"></div>
      <div class="m-tg-ring js-ring-share" style="${box(R.share, 10)}"></div>
    </div>`);
    screen.appendChild(root);
    const q = (sel) => root.querySelector(sel);
    const rStart = q(".js-row-start"), rAsk = q(".js-row-ask"), rContact = q(".js-row-contact"), rDone = q(".js-row-done");
    const mStart = rStart.firstElementChild, mAsk = rAsk.firstElementChild, mContact = rContact.firstElementChild, mDone = rDone.firstElementChild;
    const card = q(".m-tg-card"), startBar = q(".m-tg-start"), startWord = q(".m-tg-start b");
    const input = q(".m-tg-input"), keys = q(".m-tg-keys"), key = q(".m-tg-key");
    const dim = q(".m-tg-dim"), dialog = q(".m-tg-dialog"), ok = q(".m-tg-btn--ok");
    const ringStart = q(".js-ring-start"), ringKey = q(".js-ring-key"), ringShare = q(".js-ring-share");

    // A mock is hidden until its show() step; inside it, the chat is empty and waits for «НАЧАТЬ».
    gsap.set(root, { autoAlpha: 0 });
    // Each row waits exactly where its bubble will appear.
    gsap.set(rStart, { y: SHIFT.start });
    gsap.set(rAsk, { y: SHIFT.askKeys });
    gsap.set(rContact, { y: SHIFT.contact });
    gsap.set(rDone, { y: SHIFT.done });
    gsap.set([mStart, mAsk, mContact, mDone], { autoAlpha: 0, y: 10 });
    gsap.set(input, { autoAlpha: 0, y: INPUT_DROP });
    gsap.set(keys, { autoAlpha: 0, y: KEYS_DROP });
    gsap.set([dim, dialog], { autoAlpha: 0 });
    gsap.set(dialog, { scale: 1.1 });
    gsap.set([ringStart, ringKey], { autoAlpha: 0, scale: 1.03 });
    gsap.set(ringShare, { autoAlpha: 0, scale: 1.1 });

    const ringIn = (tl, el, at) => tl.to(el, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "power2.out" }, at);
    const ringOut = (tl, el, at) => tl.to(el, { autoAlpha: 0, duration: 0.2, ease: "power1.out" }, at);
    // A new bubble rises 10 pt as it fades in. When older rows have to make room for it they start 0.1 s
    // earlier (`rowsTo` at t, `bubbleIn` at t + ROOM), so the new bubble never shows through one still leaving.
    const ROOM = 0.1;
    const bubbleIn = (tl, el, at, duration = 0.35) => tl.to(el, { autoAlpha: 1, y: 0, duration, ease: "power2.out" }, at);
    const rowsTo = (tl, rows, y, at) => tl.to(rows, { y, duration: 0.4, ease: "power3.out" }, at);

    return {
      root,
      anchors: {
        startButton: R.start,
        sendNumberButton: R.key,
        shareButton: R.share,
        doneBubble: { x: 10, y: top.done, w: DONE_W, h: H.done },
      },
      steps: {
        show(tl, at) {
          tl.to(root, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, at);
          return at + 0.3;
        },
        hide(tl, at) {
          tl.to(root, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, at);
          return at + 0.3;
        },
        // «НАЧАТЬ» → the message field takes its place, «/start» goes out, the bot answers and brings its keyboard.
        tapStart(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, ringStart, at);
          V.tap(tl, screen, ...mid(R.start), tp);
          tl.to(startWord, { opacity: 0.4, duration: 0.1, ease: "power1.in" }, tp + PRESS);
          ringOut(tl, ringStart, tp + PRESS);
          // The field fades in OVER the start bar, which stays solid until it is covered (two bars fading
          // against each other would let the chat show through the bottom of the screen), then it is switched off.
          tl.to(startWord, { opacity: 0, duration: 0.15, ease: "power1.out" }, tp + 0.45)
            .to(input, { autoAlpha: 1, duration: 0.25, ease: "power1.out" }, tp + 0.45)
            .set(startBar, { autoAlpha: 0 }, tp + 0.7);
          bubbleIn(tl, mStart, tp + 0.6);
          // The bot's answer arrives with its keyboard: the field and «/start» move up, the request fades in above the field.
          // The keyboard fades as it slides, so its label is still faint while it passes under the home indicator.
          tl.to(keys, { autoAlpha: 1, duration: 0.2, ease: "none" }, tp + 0.9)
            .to(keys, { y: 0, duration: 0.4, ease: "power3.out" }, tp + 0.9)
            .to(input, { y: 0, duration: 0.4, ease: "power3.out" }, tp + 0.9);
          rowsTo(tl, rStart, SHIFT.askKeys, tp + 0.9);
          bubbleIn(tl, mAsk, tp + 0.9 + ROOM, 0.3);
          return tp + 1.3;
        },
        // «📱 Отправить мой номер» → Telegram asks whether to share the number.
        tapSendNumber(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, ringKey, at);
          V.tap(tl, screen, ...mid(R.key), tp);
          tl.to(key, { backgroundColor: "#dcd8d1", duration: 0.1, ease: "power1.in" }, tp + PRESS)
            .to(key, { backgroundColor: "#ffffff", duration: 0.2, ease: "power1.out" }, tp + 0.45);
          ringOut(tl, ringKey, tp + PRESS);
          // The bot's card lies exactly under the dialog: it steps aside while the dialog is half-transparent,
          // so its words never show through the dialog's (it comes back as the dialog closes, in tapShare).
          tl.to(card, { autoAlpha: 0, duration: 0.1, ease: "power1.out" }, tp + 0.45)
            .to(dim, { autoAlpha: 0.32, duration: 0.3, ease: "power1.out" }, tp + 0.45)
            .to(dialog, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "power3.out" }, tp + 0.45);
          return tp + 0.8;
        },
        // «Поделиться» → the contact goes out, the keyboard leaves, the bot confirms the sign-in.
        tapShare(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, ringShare, at);
          V.tap(tl, screen, ...mid(R.share), tp);
          tl.to(ok, { backgroundColor: "rgba(31,23,18,0.08)", duration: 0.1, ease: "power1.in" }, tp + PRESS);
          ringOut(tl, ringShare, tp + PRESS);
          tl.to(dialog, { autoAlpha: 0, duration: 0.2, ease: "power1.in" }, tp + 0.45)
            .to(card, { autoAlpha: 1, duration: 0.2, ease: "power1.in" }, tp + 0.55)
            .to(dim, { autoAlpha: 0, duration: 0.25, ease: "power1.out" }, tp + 0.45)
            .to(keys, { y: KEYS_DROP, duration: 0.4, ease: "power3.out" }, tp + 0.65)
            .to(keys, { autoAlpha: 0, duration: 0.2, ease: "power2.out" }, tp + 0.65)
            .to(input, { y: INPUT_DROP, duration: 0.4, ease: "power3.out" }, tp + 0.65);
          rowsTo(tl, [rStart, rAsk], SHIFT.contact, tp + 0.65);
          bubbleIn(tl, mContact, tp + 0.85);
          rowsTo(tl, [rStart, rAsk, rContact], SHIFT.done, tp + 1.3);
          bubbleIn(tl, mDone, tp + 1.3 + ROOM, 0.3);
          return tp + 1.7;
        },
      },
    };
  };
})();
