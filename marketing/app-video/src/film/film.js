// The film: one continuous take. A page of text on the left turns step by step; one phone beside it
// does what the page says (its body changes Android ↔ iPhone); the poster column on the right
// (panel.js) never moves. All times below are FILM seconds; `P` seconds of preroll run before
// frame 0 so the loop starts in the very state it ends in (the signed-in card on the phone).
(function () {
  const V = window.V;
  const P = 1;
  V.cfg.preroll = P;
  const PHONE_LEFT = 814;

  const ICON = {
    share: '<svg width="32" height="40" viewBox="0 0 32 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3v22M8.500 10.500 16 3l7.500 7.500"/><path d="M9.500 16H6a3.500 3.500 0 0 0-3.500 3.500V33A3.500 3.500 0 0 0 6 36.500h20a3.500 3.500 0 0 0 3.500-3.500V19.500A3.500 3.500 0 0 0 26 16h-3.500"/></svg>',
    dots: '<svg width="10" height="38" viewBox="0 0 10 38" fill="currentColor"><circle cx="5" cy="5" r="4.200"/><circle cx="5" cy="19" r="4.200"/><circle cx="5" cy="33" r="4.200"/></svg>',
    link: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M15.800 8.200l-2.200 5.400-5.400 2.200 2.200-5.400z" fill="currentColor"/></svg>',
    phone: '<svg width="24" height="38" viewBox="0 0 13 21"><rect width="13" height="21" rx="2.800" fill="#2c2a2e"/><rect x="1.500" y="2.900" width="10" height="14.200" rx="0.900" fill="#6fb1f0"/><circle cx="6.500" cy="19.050" r="0.850" fill="#77737c"/></svg>',
  };

  // ── the pages ──────────────────────────────────────────────────────────
  const pages = (c) => ({
    intro: {
      brand: c.brand,
      head: ["Бонусы", "с каждой покупки"],
      levels: c.levels,
      facts: `До <b>${c.maxRedeemPercent}\u202f%</b> чека можно оплатить бонусами<br><b>1 бонус = 1 ₸</b>`,
    },
    scan: {
      step: 1,
      head: ["Наведите камеру", "на код справа"],
      rows: [{ plain: "Откройте камеру телефона" }, { plain: "Нажмите на ссылку", chip: `${ICON.link}<span>ar-amir.com</span>` }],
    },
    android: {
      step: 2, platform: "Android",
      head: ["Добавьте значок", "на экран телефона"],
      rows: [
        { chip: `${ICON.dots}<span>Меню</span>`, sub: "три точки вверху справа" },
        { chip: "<span>Добавить на гл. экран</span>", sub: "или «Установить приложение»" },
        { chip: "<span>Установить</span>" },
      ],
    },
    iphone: {
      step: 2, platform: "iPhone",
      head: ["Добавьте значок", "на экран телефона"],
      rows: [
        { chip: `${ICON.share}<span>Поделиться</span>`, sub: "на новых iPhone — сначала •••" },
        { chip: "<span>На экран «Домой»</span>" },
        { chip: "<span>Добавить</span>" },
      ],
      note: "Сначала значок — потом вход",
    },
    signin: {
      step: 3,
      head: ["Войдите по номеру", "телефона"],
      rows: [
        { chip: `<img src="../assets/icon-192.png" alt=""><span>${c.brand}</span>`, sub: "значок на экране телефона" },
        { plain: "Введите номер и имя" },
        { chip: `<span>Открыть ${c.signInVia}</span>` },
        { chip: `${ICON.phone}<span>Отправить мой номер</span>` },
        { plain: "Вернитесь в приложение" },
      ],
      tight: true,
    },
    till: {
      step: 4,
      head: ["Покажите карту", "на кассе"],
      rows: [{ plain: "Кассир считает код с экрана" }, { plain: "Или назовите номер телефона" }],
      note: "Бонусы начисляются после покупки",
    },
  });

  const pageHtml = (id, p) => `<div class="f-page" data-page="${id}">
    ${p.step ? `<div class="f-step js-top"><span>Шаг ${p.step} из 4</span><span class="f-step-dots">${[1, 2, 3, 4].map((n) => `<i class="${n <= p.step ? "on" : ""}"></i>`).join("")}</span></div>` : `<div class="f-brandline js-top">${p.brand}</div>`}
    ${p.platform ? `<div class="f-platform js-plat">${p.platform}</div>` : ""}
    <h2 class="f-head">${p.head.map((l) => `<span class="f-line"><span>${l}</span></span>`).join("")}</h2>
    ${p.levels ? `<div class="f-levels">${p.levels.map((l) => `<div class="f-level js-item"><b>${l.percent}\u202f%</b><span>${l.name}</span></div>`).join("")}</div><p class="f-facts js-item">${p.facts}</p>` : ""}
    ${p.rows ? `<ol class="f-rows"${p.tight ? ' style="gap:14px;margin-top:36px"' : ""}>${p.rows.map((r, i) => `<li class="f-row js-item"><b class="f-bullet">${i + 1}<u>${i + 1}</u></b><div class="f-row-body">
        ${r.plain ? `<span class="f-plain">${r.plain}</span>` : ""}
        ${r.chip ? `<span class="f-chip"><u></u>${r.chip}</span>` : ""}
        ${r.sub ? `<span class="f-sub">${r.sub}</span>` : ""}
      </div></li>`).join("")}</ol>` : ""}
    ${p.note ? `<p class="f-note js-note">${p.note}</p>` : ""}
  </div>`;

  V.scene({
    id: "film", start: 0, duration: 9999,
    html: (c) => `<div class="f-col">${Object.entries(pages(c)).map(([id, p]) => pageHtml(id, p)).join("")}</div>
      <svg class="f-leads" viewBox="0 0 1920 1080"></svg>
      <div class="f-brackets"><i></i><i></i><i></i><i></i></div>
      <div class="f-phone js-android"></div>
      <div class="f-phone js-iphone"></div>`,
    build({ root, tl, q, qa, cfg }) {
      const frame = document.getElementById("frame");
      const rect = (el) => {
        const f = frame.getBoundingClientRect(), k = f.width / 1920, r = el.getBoundingClientRect();
        return { x: (r.left - f.left) / k, y: (r.top - f.top) / k, w: r.width / k, h: r.height / k };
      };
      const T = (film) => P + film;

      // ── phones and their screens ──
      const phoneA = V.phone({ kind: "android" }), phoneI = V.phone({ kind: "iphone" });
      q(".js-android").appendChild(phoneA);
      q(".js-iphone").appendChild(phoneI);
      const M = V.mocks;
      const cam = M.cameraScan(phoneA), and = M.androidInstall(phoneA);
      const ios = M.iosInstall(phoneI);
      const login = M.appLogin ? M.appLogin(phoneI) : null;
      const tg = M.telegramLogin(phoneI);
      const card = M.appCard ? M.appCard(phoneI) : null;
      gsap.set(phoneA, { autoAlpha: 0 });
      const swap = (at, from, to) => {
        tl.to(from, { autoAlpha: 0, y: 24, scale: 0.985, duration: 0.3, ease: "power2.in" }, at)
          .set(from, { y: 0, scale: 1 }, at + 0.32)
          .set(to, { y: -24, scale: 0.985 }, at + 0.2)
          .to(to, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out" }, at + 0.2);
      };

      // ── the pages: everything starts hidden, measured before anything is moved ──
      const svg = q(".f-leads");
      const page = {};
      for (const el of qa(".f-page")) {
        const id = el.dataset.page;
        const rows = Array.from(el.querySelectorAll(".f-row")).map((row) => ({
          el: row,
          bulletOn: row.querySelector(".f-bullet > u"),
          chipOn: row.querySelector(".f-chip > u"),
          target: row.querySelector(".f-chip") || row.querySelector(".f-plain"),
          lead: null,
        }));
        page[id] = { el, rows, top: el.querySelector(".js-top"), plat: el.querySelector(".js-plat"), lines: Array.from(el.querySelectorAll(".f-line > span")), items: Array.from(el.querySelectorAll(".js-item")), note: el.querySelector(".js-note") };
      }
      // A gold line from a row to the control it names on the phone.
      const lead = (pg, i, phone, anchor) => {
        const r = rect(page[pg].rows[i].target), a = V.onStage(phone, anchor);
        const x0 = r.x + r.w + 14, y0 = r.y + r.h / 2, x2 = PHONE_LEFT - 12, y2 = a.y + a.h / 2;
        const x1 = Math.max(x0 + 26, PHONE_LEFT - 46), rr = Math.min(16, Math.abs(y2 - y0) / 2), s = y2 > y0 ? 1 : -1;
        const d = Math.abs(y2 - y0) < 3
          ? `M${x0} ${y0}H${x2}`
          : `M${x0} ${y0}H${x1 - rr}Q${x1} ${y0} ${x1} ${y0 + s * rr}V${y2 - s * rr}Q${x1} ${y2} ${x1 + rr} ${y2}H${x2}`;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.innerHTML = `<path d="${d}"/><circle cx="${x2}" cy="${y2}" r="6"/>`;
        svg.appendChild(g);
        const path = g.querySelector("path"), dot = g.querySelector("circle"), len = path.getTotalLength();
        gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
        gsap.set(dot, { scale: 0, transformOrigin: "50% 50%" });
        gsap.set(g, { autoAlpha: 0 });
        page[pg].rows[i].lead = { g, path, dot };
      };
      lead("scan", 1, phoneA, cam.anchors.link);
      lead("android", 0, phoneA, and.anchors.menuButton);
      lead("android", 1, phoneA, and.anchors.addToHomeRow);
      lead("android", 2, phoneA, and.anchors.installButton);
      lead("iphone", 0, phoneI, ios.anchors.share);
      lead("iphone", 1, phoneI, ios.anchors.addToHomeRow);
      lead("iphone", 2, phoneI, ios.anchors.addButton);
      lead("signin", 0, phoneI, ios.anchors.homeIcon);
      if (login) lead("signin", 2, phoneI, login.anchors.telegramButton);
      lead("signin", 3, phoneI, tg.anchors.sendNumberButton);
      // The brackets around the real code in the poster column.
      const qrCard = rect(document.querySelector("#scene-panel .qr"));
      const brackets = q(".f-brackets");
      gsap.set(brackets, { left: qrCard.x - 16, top: qrCard.y - 16, width: qrCard.w + 32, height: qrCard.h + 32, autoAlpha: 0, scale: 1.08 });

      for (const pg of Object.values(page)) {
        gsap.set(pg.el, { autoAlpha: 0 });
        gsap.set([pg.top, pg.plat].filter(Boolean), { autoAlpha: 0, y: 16 });
        gsap.set(pg.lines, { yPercent: 112 });
        gsap.set(pg.items, { autoAlpha: 0, y: 20 });
        if (pg.note) gsap.set(pg.note, { autoAlpha: 0, y: 14 });
        for (const r of pg.rows) {
          gsap.set(r.bulletOn, { autoAlpha: 0, scale: 0.6 });
          if (r.chipOn) gsap.set(r.chipOn, { autoAlpha: 0 });
        }
      }
      // A page arrives: its label, the headline line by line, then its rows — all of it early,
      // so a slow reader has the whole scene to read; only the highlight moves afterwards.
      const pageIn = (id, at, { note = true } = {}) => {
        const pg = page[id];
        tl.set(pg.el, { autoAlpha: 1, y: 0 }, at)
          .to([pg.top, pg.plat].filter(Boolean), { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.1 }, at)
          .to(pg.lines, { yPercent: 0, duration: 0.7, stagger: 0.13, ease: "power4.out" }, at + (pg.plat ? 0.2 : 0.1))
          .to(pg.items, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.09 }, at + 0.5);
        if (pg.note && note) tl.to(pg.note, { autoAlpha: 1, y: 0, duration: 0.5 }, at + 0.5 + 0.09 * pg.items.length + 0.15);
      };
      const pageOut = (id, at) => {
        const pg = page[id];
        tl.to(pg.el, { autoAlpha: 0, y: -14, duration: 0.35, ease: "power2.in" }, at);
        for (const r of pg.rows) if (r.lead) tl.to(r.lead.g, { autoAlpha: 0, duration: 0.25 }, at);
      };
      // The highlight moves to row i (and its line is drawn); earlier rows calm down.
      const on = (id, i, at, hold = 1.3) => {
        const pg = page[id];
        pg.rows.forEach((r, j) => {
          if (j >= i) return;
          tl.to(r.bulletOn, { autoAlpha: 0.38, duration: 0.3 }, at);
          if (r.chipOn) tl.to(r.chipOn, { autoAlpha: 0, duration: 0.3 }, at);
          if (r.lead) tl.to(r.lead.g, { autoAlpha: 0, duration: 0.25 }, at);
        });
        const r = pg.rows[i];
        tl.to(r.bulletOn, { autoAlpha: 1, scale: 1, duration: 0.4, ease: "back.out(2)" }, at);
        if (r.chipOn) tl.to(r.chipOn, { autoAlpha: 1, duration: 0.3 }, at);
        if (r.lead) {
          // The line points at a control that is about to be touched: it leaves once the screen has changed.
          tl.set(r.lead.g, { autoAlpha: 1 }, at)
            .to(r.lead.path, { strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut" }, at + 0.05)
            .to(r.lead.dot, { scale: 1, duration: 0.25, ease: "back.out(2.5)" }, at + 0.45)
            .to(r.lead.g, { autoAlpha: 0, duration: 0.3 }, at + hold);
        }
      };

      // ══ the take ═════════════════════════════════════════════════════════
      let t;
      // Preroll: the phone already shows the signed-in card — the state the last frame leaves.
      if (card) card.steps.show(tl, 0, { balance: "full" });

      // 0 — what the card gives.
      pageIn("intro", T(0.2));
      pageOut("intro", T(4.5));

      // 1 — the camera and the code.
      swap(T(4.6), phoneI, phoneA);
      cam.steps.show(tl, T(4.6));
      if (card) card.steps.hide(tl, T(5.1));
      pageIn("scan", T(4.9));
      on("scan", 0, T(5.7));
      t = cam.steps.aim(tl, T(5.7));
      tl.to(brackets, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "back.out(1.8)" }, T(6.3))
        .to(brackets, { scale: 1.03, duration: 0.5, ease: "sine.inOut", yoyo: true, repeat: 3 }, T(6.8))
        .to(brackets, { autoAlpha: 0, duration: 0.4 }, T(8.9));
      t = cam.steps.recognise(tl, t + 0.15);
      on("scan", 1, t + 0.3);
      t = cam.steps.tapLink(tl, t + 0.9);
      and.steps.show(tl, t - 0.3);
      cam.steps.hide(tl, t);
      pageOut("scan", t + 0.9);

      // 2 — Android.
      const A0 = t + 1.2;
      pageIn("android", A0);
      on("android", 0, A0 + 1.5);
      t = and.steps.tapMenu(tl, A0 + 1.5);
      on("android", 1, t + 0.45);
      t = and.steps.tapAddToHome(tl, t + 0.45);
      on("android", 2, t + 0.45);
      t = and.steps.tapInstall(tl, t + 0.45);
      pageOut("android", t + 0.7);

      // 2 — iPhone.
      const I0 = t + 0.9;
      ios.steps.show(tl, I0 - 0.1);
      swap(I0, phoneA, phoneI);
      and.steps.hide(tl, I0 + 0.4);
      pageIn("iphone", I0 + 0.25);
      on("iphone", 0, I0 + 1.7);
      t = ios.steps.tapShare(tl, I0 + 1.7);
      on("iphone", 1, t + 0.45);
      t = ios.steps.tapAddToHome(tl, t + 0.45);
      on("iphone", 2, t + 0.45);
      t = ios.steps.tapAdd(tl, t + 0.45);
      pageOut("iphone", t + 0.7);

      // 3 — sign in: open the icon, the number, Telegram, back to the app.
      const S0 = t + 1.0;
      pageIn("signin", S0);
      on("signin", 0, S0 + 1.3);
      t = ios.steps.openIcon(tl, S0 + 1.6);
      if (login) {
        login.steps.show(tl, t - 0.1);
        ios.steps.hide(tl, t + 0.25);
        on("signin", 1, t + 0.5);
        t = login.steps.typeNumber(tl, t + 0.6);
        t = login.steps.fillRest(tl, t + 0.1);
        t = login.steps.tapContinue(tl, t + 0.2);
        on("signin", 2, t + 0.3);
        t = login.steps.tapOpenTelegram(tl, t + 0.3);
      } else {
        t = ios.steps.hide(tl, t + 0.4);
      }
      tg.steps.show(tl, t - 0.25);
      t = tg.steps.tapStart(tl, t + 0.2);
      on("signin", 3, t + 0.25);
      t = tg.steps.tapSendNumber(tl, t + 0.25);
      t = tg.steps.tapShare(tl, t + 0.25);
      on("signin", 4, t + 0.5);
      if (card) card.steps.show(tl, t + 1.0, { balance: "zero" });
      tg.steps.hide(tl, t + 1.3);
      if (login) login.steps.hide(tl, t + 1.3);
      t = t + 1.6;
      pageOut("signin", t + 1.0);

      // 4 — the till.
      const K0 = t + 1.3;
      pageIn("till", K0, { note: false });
      if (card) {
        on("till", 0, K0 + 1.3);
        t = card.steps.scrollToQr(tl, K0 + 1.3);
        t = card.steps.scan(tl, t + 0.2);
        on("till", 1, t + 0.5);
        t = card.steps.scrollToTop(tl, t + 1.6);
        t = card.steps.addBonus(tl, t + 0.2);
      } else {
        t = K0 + 5;
      }
      tl.to(page.till.note, { autoAlpha: 1, y: 0, duration: 0.5 }, t - 0.9);
      pageOut("till", t + 1.7);
      const END = t + 2.2; // the phone now shows the card with its bonuses: frame 0 again
      tl.to({}, { duration: 0.01 }, END - 0.01);
      V.cfg.duration = END;
    },
  });
})();
