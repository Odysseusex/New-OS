// MOCK: installing the app on Android from Chrome.
//   const and = V.mocks.androidInstall(phone);   // phone = V.phone({ kind: "android" })
//   let t = and.steps.show(tl, 0);               // 0.3 s  Chrome with ar-amir.com/app open (hidden until then)
//   t = and.steps.tapMenu(tl, t + 0.8);          // 1.35 s gold ring on «⋮», a touch, the menu drops from the corner
//   t = and.steps.tapAddToHome(tl, t + 0.8);     // 1.5 s  ring on «Добавить на гл. экран», a touch, the install dialog
//   t = and.steps.tapInstall(tl, t + 0.8);       // 3.2 s  ring on «Установить», a touch, home screen, the icon pops in
//   t = and.steps.openIcon(tl, t + 0.8);         // 1.5 s  ring on the icon, a touch, the app opens on its logo
//   t = and.steps.hide(tl, t + 0.8);             // 0.3 s  the whole mock fades away
// Every step adds its tweens to `tl` at `at` and returns the time it ends. In a tap step the gold ring
// fades in from `at` and the touch lands 0.55 s later; the screen changes 0.45 s after the touch.
// anchors (menuButton, addToHomeRow, installButton, homeIcon): rectangles in the phone's own points
// (origin: top-left of .phone-screen, 390 × 844).
(function () {
  const V = window.V;
  V.mocks = V.mocks || {};
  const A = "../assets/";

  // Grey line icons, drawn here (24 × 24).
  const ic = (body, size = 24, sw = 1.7) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const P = {
    home: '<path d="M4.5 10.6 12 4.4l7.5 6.2V19a1 1 0 0 1-1 1h-4v-5.4h-5V20h-4a1 1 0 0 1-1-1z"/>',
    tune: '<path d="M4 8h8.6M17.4 8H20M4 16h2.6M11.4 16H20"/><circle cx="15" cy="8" r="2.4"/><circle cx="9" cy="16" r="2.4"/>',
    dots: '<circle cx="12" cy="5.2" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="18.8" r="1.9" fill="currentColor" stroke="none"/>',
    forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    star: '<path d="M12 3.8l2.55 5.2 5.75.8-4.15 4.05.98 5.7L12 16.85l-5.13 2.7.98-5.7L3.7 9.8l5.75-.8z"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5.5 19.5h13"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.2v5.3"/><circle cx="12" cy="7.9" r="0.7" fill="currentColor"/>',
    reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.3v4.2h-4.2"/>',
    newTab: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M12 8v8M8 12h8"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7"/><path d="M4 4.2v4.5h4.5"/><path d="M12 7.8V12l3 1.8"/>',
    share: '<circle cx="17.5" cy="5.5" r="2.4"/><circle cx="6.5" cy="12" r="2.4"/><circle cx="17.5" cy="18.5" r="2.4"/><path d="M8.6 10.8l6.8-4M8.6 13.2l6.8 4"/>',
    find: '<circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2 20 20"/>',
    // A phone outline with an arrow coming in: «Добавить на гл. экран».
    addHome: '<path d="M17 7.5V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2.5"/><path d="M21 12h-8.5M15.7 8.8 12.5 12l3.2 3.2"/>',
    gear: '<g transform="translate(12 12) scale(0.84) translate(-12 -12)" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></g>',
  };

  // ── geometry, in phone points (the anchors and the drawing share these numbers) ──
  const DOTS = { x: 342, y: 55, w: 40, h: 40 };            // the «⋮» button (its round touch area)
  const MENU = { x: 112, y: 51, w: 270 };                  // drops from the top-right corner, over the toolbar
  const ROW_H = 48;
  const ROWS = [
    { icon: "newTab", label: "Новая вкладка", gap: true },
    { icon: "history", label: "История" },
    { icon: "download", label: "Скачанные файлы" },
    { icon: "star", label: "Закладки", gap: true },
    { icon: "share", label: "Поделиться…" },
    { icon: "find", label: "Найти на странице" },
    { icon: "addHome", label: "Добавить на гл. экран", target: true, gap: true },
    { icon: "gear", label: "Настройки" },
  ];
  const DIALOG = { x: 39, y: 323, w: 312, h: 198 };
  const INSTALL = { x: 180, y: 140, w: 116, h: 40 };       // inside the dialog
  const CANCEL = { x: 90, y: 140, w: 86, h: 40 };
  const COLS = [66, 152, 238, 324];                        // home screen: column centres
  const TILE = 60;
  const ICON = { x: COLS[2] - TILE / 2, y: 568, w: TILE, h: TILE }; // the free slot the new icon lands in
  const DOCK = { x: COLS[1], y: 676 + TILE / 2 };           // the dock tile Chrome shrinks back into
  const LOGO = 110;                                        // the logo on the opening app

  V.mocks.androidInstall = function (phone) {
    const screen = phone.querySelector(".phone-screen");

    // The menu: a row of small actions, then the list.
    let y = 4 + ROW_H + 4;
    let menuHtml = `<div class="m-and-menu-icons">${["forward", "star", "download", "info", "reload"].map((k) => ic(P[k])).join("")}</div>`;
    menuHtml += `<i class="m-and-menu-div" style="top:${y}px"></i>`;
    y += 5;
    let targetY = 0;
    ROWS.forEach((r) => {
      if (r.target) targetY = y;
      menuHtml += `<div class="m-and-row${r.target ? " js-target" : ""}" style="top:${y}px">${ic(P[r.icon])}<span>${r.label}</span></div>`;
      y += ROW_H;
      if (r.gap) { menuHtml += `<i class="m-and-menu-div" style="top:${y + 4}px"></i>`; y += 9; }
    });
    const menuH = y + 6;
    menuHtml += `<i class="m-and-ring js-ring-row" style="left:6px;top:${targetY + 3}px;width:${MENU.w - 12}px;height:${ROW_H - 6}px;border-radius:13px"></i>`;

    // The home screen: quiet placeholder tiles, a dock, a search pill.
    const tile = (cx, top, tone, name) =>
      `<i class="m-and-tile m-and-tone-${tone}" style="left:${cx - TILE / 2}px;top:${top}px"></i>` +
      (name ? `<i class="m-and-name" style="left:${cx - name / 2}px;top:${top + TILE + 14}px;width:${name}px"></i>` : "");
    const homeHtml =
      tile(COLS[0], 460, 1, 38) + tile(COLS[1], 460, 4, 30) + tile(COLS[2], 460, 2, 42) + tile(COLS[3], 460, 5, 34) +
      tile(COLS[0], 568, 3, 34) + tile(COLS[1], 568, 1, 40) +
      tile(COLS[0], 676, 5, 0) + tile(COLS[1], 676, 2, 0) + tile(COLS[2], 676, 1, 0) + tile(COLS[3], 676, 4, 0);

    const root = V.h(`<div class="m-and layer">
      <div class="m-and-home">
        <i class="m-and-wall-a"></i><i class="m-and-wall-b"></i>
        <div class="m-and-glance"><i></i><i></i></div>
        ${homeHtml}
        <div class="m-and-search">${ic(P.find, 22, 1.9)}<i></i></div>
        <i class="m-and-ring js-ring-pulse" style="left:${ICON.x - 5}px;top:${ICON.y - 5}px;width:${TILE + 10}px;height:${TILE + 10}px;border-radius:23px"></i>
        <i class="m-and-ring js-ring-icon" style="left:${ICON.x - 5}px;top:${ICON.y - 5}px;width:${TILE + 10}px;height:${TILE + 10}px;border-radius:23px"></i>
        <div class="m-and-app" style="left:${ICON.x}px;top:${ICON.y}px"><img src="${A}icon-192.png" alt=""></div>
        <div class="m-and-app-name" style="left:${ICON.x - 20}px;top:${ICON.y + TILE + 9}px">Ar Amir</div>
      </div>
      <div class="m-and-chrome">
        <div class="m-and-page">${V.shot("login-empty").outerHTML}</div>
        <div class="m-and-bar">
          <span class="m-and-btn" style="left:4px">${ic(P.home)}</span>
          <div class="m-and-pill">${ic(P.tune, 18, 1.9)}<span>ar-amir.com<em>/app</em></span></div>
          <span class="m-and-btn" style="left:286px"><b class="m-and-tabs">1</b></span>
          <i class="m-and-press" style="left:${DOTS.x}px;top:${DOTS.y}px;width:${DOTS.w}px;height:${DOTS.h}px"></i>
          <span class="m-and-btn" style="left:338px">${ic(P.dots)}</span>
          <i class="m-and-ring js-ring-dots" style="left:${DOTS.x}px;top:${DOTS.y}px;width:${DOTS.w}px;height:${DOTS.h}px;border-radius:50%"></i>
        </div>
        <div class="m-and-menu" style="left:${MENU.x}px;top:${MENU.y}px;width:${MENU.w}px;height:${menuH}px">${menuHtml}</div>
        <div class="m-and-scrim"></div>
        <div class="m-and-dialog" style="left:${DIALOG.x}px;top:${DIALOG.y}px;width:${DIALOG.w}px;height:${DIALOG.h}px">
          <div class="m-and-dialog-title">Установить приложение</div>
          <div class="m-and-dialog-app"><img src="${A}icon-192.png" alt=""><div><b>Ar Amir</b><span>ar-amir.com</span></div></div>
          <span class="m-and-dbtn" style="left:${CANCEL.x}px;top:${CANCEL.y}px;width:${CANCEL.w}px">Отмена</span>
          <span class="m-and-dbtn js-install" style="left:${INSTALL.x}px;top:${INSTALL.y}px;width:${INSTALL.w}px">Установить</span>
          <i class="m-and-ring js-ring-install" style="left:${INSTALL.x - 2}px;top:${INSTALL.y - 2}px;width:${INSTALL.w + 4}px;height:${INSTALL.h + 4}px;border-radius:22px"></i>
        </div>
      </div>
      <div class="m-and-launch-wrap"><div class="m-and-launch"><img src="${A}logo.png" style="left:${195 - LOGO / 2}px;top:${422 - LOGO / 2}px;width:${LOGO}px;height:${LOGO}px" alt=""></div></div>
    </div>`);
    screen.appendChild(root);
    gsap.set(root, { autoAlpha: 0 });

    const $ = (sel) => root.querySelector(sel);
    const home = $(".m-and-home"), chrome = $(".m-and-chrome"), menu = $(".m-and-menu"), scrim = $(".m-and-scrim");
    const dialog = $(".m-and-dialog"), launchWrap = $(".m-and-launch-wrap"), launch = $(".m-and-launch"), logo = launch.querySelector("img");
    const press = $(".m-and-press"), row = $(".js-target"), install = $(".js-install");
    const app = $(".m-and-app"), appName = $(".m-and-app-name");
    const ringDots = $(".js-ring-dots"), ringRow = $(".js-ring-row"), ringInstall = $(".js-ring-install");
    const ringPulse = $(".js-ring-pulse"), ringIcon = $(".js-ring-icon");

    // Everything starts in its "not yet" state; steps only tween forward from here.
    gsap.set([ringDots, ringRow, ringInstall, ringPulse, ringIcon, press, scrim], { autoAlpha: 0 });
    gsap.set(ringPulse, { scale: 0.9 });
    gsap.set(menu, { autoAlpha: 0, scale: 0.82, transformOrigin: "100% 0%" });
    gsap.set(row, { backgroundColor: "rgba(31,31,31,0)" });
    gsap.set(install, { backgroundColor: "rgba(11,87,208,0)" });
    gsap.set(dialog, { autoAlpha: 0, scale: 0.92 });
    gsap.set(chrome, { x: 0, y: 0, scale: 1, borderRadius: 36 }); // owned by GSAP from the start: same pixels before and after its tween
    gsap.set(home, { autoAlpha: 0, scale: 1.06 });
    gsap.set(app, { autoAlpha: 0, scale: 0.4 });
    gsap.set(appName, { autoAlpha: 0, y: -4 });
    const cx = ICON.x + TILE / 2, cy = ICON.y + TILE / 2;
    const closed = `inset(${ICON.y}px ${390 - ICON.x - TILE}px ${844 - ICON.y - TILE}px ${ICON.x}px round 19px)`;
    gsap.set(launchWrap, { autoAlpha: 0 });
    gsap.set(launch, { clipPath: closed });
    gsap.set(logo, { x: cx - 195, y: cy - 422, scale: TILE / LOGO });

    // The gold ring that says "this one": fades in before the touch.
    const ringIn = (tl, ring, at) => tl.to(ring, { autoAlpha: 1, duration: 0.45, ease: "power1.out" }, at);
    const RING = 0.55; // from the start of a step to its touch

    const anchors = {
      menuButton: { ...DOTS },
      addToHomeRow: { x: MENU.x, y: MENU.y + targetY, w: MENU.w, h: ROW_H },
      installButton: { x: DIALOG.x + INSTALL.x, y: DIALOG.y + INSTALL.y, w: INSTALL.w, h: INSTALL.h },
      homeIcon: { ...ICON },
    };

    return {
      root,
      anchors,
      steps: {
        // Chrome with the page open. Light screens throughout: the status bar stays dark.
        show(tl, at) {
          tl.to(root, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, at);
          return at + 0.3;
        },
        hide(tl, at) {
          tl.to(root, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, at);
          return at + 0.3;
        },
        // «⋮» → the menu drops from the top-right corner.
        tapMenu(tl, at) {
          const T = at + RING;
          ringIn(tl, ringDots, at);
          V.tap(tl, screen, DOTS.x + DOTS.w / 2, DOTS.y + DOTS.h / 2, T);
          tl.to(press, { autoAlpha: 1, duration: 0.1, ease: "power1.out" }, T + 0.24)
            .to([press, ringDots], { autoAlpha: 0, duration: 0.15, ease: "power1.in" }, T + 0.42)
            .to(menu, { autoAlpha: 1, duration: 0.12, ease: "power1.out" }, T + 0.42)
            .to(menu, { scale: 1, duration: 0.36, ease: "power3.out" }, T + 0.42);
          return T + 0.8;
        },
        // «Добавить на гл. экран» → the menu closes, the install dialog appears over a dimmed page.
        tapAddToHome(tl, at) {
          const T = at + RING;
          const a = anchors.addToHomeRow;
          ringIn(tl, ringRow, at);
          V.tap(tl, screen, a.x + a.w - 40, a.y + a.h / 2, T);
          tl.to(row, { backgroundColor: "rgba(31,31,31,0.1)", duration: 0.1, ease: "power1.out" }, T + 0.24)
            .to(menu, { autoAlpha: 0, duration: 0.12, ease: "power1.in" }, T + 0.45)
            .to(scrim, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, T + 0.5)
            .to(dialog, { autoAlpha: 1, duration: 0.2, ease: "power1.out" }, T + 0.55)
            .to(dialog, { scale: 1, duration: 0.4, ease: "power3.out" }, T + 0.55);
          return T + 0.95;
        },
        // «Установить» → dialog and Chrome go away, the home screen, the new icon pops into its slot.
        tapInstall(tl, at) {
          const T = at + RING;
          const a = anchors.installButton;
          ringIn(tl, ringInstall, at);
          V.tap(tl, screen, a.x + a.w / 2, a.y + a.h / 2, T);
          tl.to(install, { backgroundColor: "rgba(11,87,208,0.12)", duration: 0.1, ease: "power1.out" }, T + 0.24)
            .to(dialog, { autoAlpha: 0, scale: 0.96, duration: 0.2, ease: "power1.in" }, T + 0.45)
            .to(scrim, { autoAlpha: 0, duration: 0.25, ease: "power1.in" }, T + 0.45)
            // Chrome leaves as a solid window shrinking into its dock tile; the home screen settles under it
            .set(home, { autoAlpha: 1 }, T + 0.7)
            .to(chrome, { x: DOCK.x - 195, y: DOCK.y - 422, scale: 0.15, borderRadius: 120, duration: 0.5, ease: "power3.inOut" }, T + 0.7)
            .to(chrome, { autoAlpha: 0, duration: 0.16, ease: "power1.in" }, T + 1.02)
            .to(home, { scale: 1, duration: 0.5, ease: "power2.inOut" }, T + 0.7)
            // the new icon pops into its slot
            .to(app, { autoAlpha: 1, duration: 0.18, ease: "power1.out" }, T + 1.3)
            .to(app, { scale: 1, duration: 0.45, ease: "back.out(1.6)" }, T + 1.3)
            .to(appName, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power2.out" }, T + 1.48)
            // one gold pulse around it
            .to(ringPulse, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "power2.out" }, T + 1.6)
            .to(ringPulse, { autoAlpha: 0, scale: 1.22, duration: 0.55, ease: "power1.out" }, T + 2.1);
          return T + 2.65;
        },
        // A touch on the new icon → the app opens: paper and the logo grow out of the icon.
        openIcon(tl, at) {
          const T = at + RING;
          ringIn(tl, ringIcon, at);
          V.tap(tl, screen, cx, cy, T);
          tl.to(app, { scale: 0.93, duration: 0.12, ease: "power1.in" }, T + 0.24)
            .to(app, { scale: 1, duration: 0.14, ease: "power1.out" }, T + 0.36)
            .to(ringIcon, { autoAlpha: 0, duration: 0.15, ease: "power1.in" }, T + 0.45)
            .set(launchWrap, { autoAlpha: 1 }, T + 0.45)
            .to(launch, { clipPath: "inset(0px 0px 0px 0px round 36px)", duration: 0.45, ease: "power3.inOut" }, T + 0.45)
            .to(logo, { x: 0, y: 0, scale: 1, duration: 0.45, ease: "power3.inOut" }, T + 0.45);
          return T + 0.95;
        },
      },
    };
  };
})();
