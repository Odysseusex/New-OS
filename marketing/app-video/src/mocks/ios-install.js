// MOCK: putting the app on an iPhone's home screen from Safari (iOS 17/18 look).
//   const ios = V.mocks.iosInstall(phone);          // phone kind: "iphone"
//   let t = ios.steps.show(tl, 0);                  // Safari with ar-amir.com/app open (hidden until then)
//   t = ios.steps.tapShare(tl, t + 0.8);            // ring on «Поделиться» → touch → the share sheet
//   t = ios.steps.tapAddToHome(tl, t + 0.8);        // ring on «На экран «Домой»» → touch → the add screen
//   t = ios.steps.tapAdd(tl, t + 0.8);              // ring on «Добавить» → touch → home screen, the icon pops in
//   t = ios.steps.openIcon(tl, t + 0.8);            // touch on the icon → the app's launch screen (stays)
//   t = ios.steps.hide(tl, t + 0.8);                // everything fades away
// Every step adds its tweens to `tl` at `at` and returns the time it ends.
// A ringed step: the gold ring fades in for 0.5 s from `at`, the touch starts at `at + 0.7`.
// anchors: rectangles in the phone's own points (origin: top-left of .phone-screen, 390 × 844).
(function () {
  const V = window.V;
  V.mocks = V.mocks || {};
  const A = "../assets/";
  const LEAD = 0.7; // ring first, then the touch
  // The launch layer's shadow at full strength, written the way the browser reports it (colour first) so the tween
  // from the transparent one in the CSS pairs the numbers up correctly.
  const LAUNCH_SHADOW = "rgba(31, 23, 18, 0.26) 0px 18px 50px 0px";

  // Line icons, drawn after the system's own (stroke = currentColor).
  const svg = (w, h, box, sw, body) => `<svg width="${w}" height="${h}" viewBox="0 0 ${box}" stroke-width="${sw}">${body}</svg>`;
  const I = {
    back: svg(13, 22, "13 22", 2.5, '<path d="M10.5 2.5 2.5 11l8 8.5"/>'),
    forward: svg(13, 22, "13 22", 2.5, '<path d="M2.5 2.5l8 8.5-8 8.5"/>'),
    // The key icon: an open-topped box with an arrow rising out of it.
    share: svg(22, 28, "22 28", 1.9, '<path d="M7.2 10.5H5.3a2.8 2.8 0 0 0-2.8 2.8v9.4a2.8 2.8 0 0 0 2.8 2.8h11.4a2.8 2.8 0 0 0 2.8-2.8v-9.4a2.8 2.8 0 0 0-2.8-2.8h-1.9"/><path d="M11 17.6V2.7"/><path d="M6.5 7 11 2.5 15.5 7"/>'),
    book: svg(26, 22, "26 22", 1.8, '<path d="M13 4.3C10.6 2.7 7 2.3 2.5 3v14.6c4.5-.7 8.1-.3 10.5 1.3 2.4-1.6 6-2 10.5-1.3V3C19 2.3 15.4 2.7 13 4.3z"/><path d="M13 4.3v14.6"/>'),
    tabs: svg(24, 24, "24 24", 1.8, '<rect x="2.5" y="7.5" width="14" height="14" rx="3.2"/><path d="M7.5 7.5V5.7a3.2 3.2 0 0 1 3.2-3.2h7.6a3.2 3.2 0 0 1 3.2 3.2v7.6a3.2 3.2 0 0 1-3.2 3.2h-1.8"/>'),
    reload: svg(18, 20, "24 26", 2.1, '<path d="M20.5 14a8.5 8.5 0 1 1-3.04-6.51"/><path d="M18 2.6v5.3h-5.3"/>'),
    close: svg(12, 12, "12 12", 2.1, '<path d="M2 2l8 8M10 2l-8 8"/>'),
    clear: svg(8, 8, "8 8", 1.5, '<path d="M1.5 1.5l5 5M6.5 1.5l-5 5"/>'),
    copy: svg(24, 24, "24 24", 1.6, '<rect x="4.5" y="7" width="11" height="14.5" rx="2.3"/><path d="M8.5 7V5a2.3 2.3 0 0 1 2.3-2.3h6.4A2.3 2.3 0 0 1 19.5 5v10.2a2.3 2.3 0 0 1-2.3 2.3h-1.7"/>'),
    glasses: svg(24, 24, "24 24", 1.6, '<circle cx="6.8" cy="15.3" r="3.9"/><circle cx="17.2" cy="15.3" r="3.9"/><path d="M10.6 14.4a1.6 1.6 0 0 1 2.8 0"/><path d="M3 14.4 4.5 8.1c.3-1.2 1.3-1.8 2.5-1.5"/><path d="M21 14.4l-1.5-6.3c-.3-1.2-1.3-1.8-2.5-1.5"/>'),
    bookmark: svg(24, 24, "24 24", 1.6, '<path d="M12 6.3C10 5 6.9 4.6 3 5.2v12.9c3.9-.6 7-.2 9 1.1 2-1.3 5.1-1.7 9-1.1V5.2c-3.9-.6-7-.2-9 1.1z"/><path d="M12 6.3v12.9"/>'),
    find: svg(24, 24, "24 24", 1.6, '<path d="M11.5 21H7a2.3 2.3 0 0 1-2.3-2.3V5.3A2.3 2.3 0 0 1 7 3h8.2a2.3 2.3 0 0 1 2.3 2.3v4.9"/><path d="M8.3 7.5h5.7M8.3 11h2.7"/><circle cx="15.9" cy="16.3" r="3.3"/><path d="M18.4 18.8l2.6 2.6"/>'),
    plusApp: svg(24, 24, "24 24", 1.6, '<rect x="3.5" y="3.5" width="17" height="17" rx="4.7"/><path d="M12 8v8M8 12h8"/>'),
  };

  // Home screen: 4 columns, 60 pt tiles. Three full rows and two more tiles; the new icon takes the next slot.
  const COL = (c) => 27 + c * 92, ROW = (r) => 82 + r * 98;
  const TONES = ["#faf6ee", "#c4b49e", "#f3ecdf", "#b3a38e", "#d1c2ab", "#fbf8f2", "#bdad97", "#efe6d7", "#a89985", "#f7f2e8", "#cbbca6", "#b8a892", "#f4ede1", "#c7b7a1"];
  const BARS = [34, 28, 40, 30, 36, 26, 38, 32, 30, 40, 28, 34, 36, 30];
  const DOCK = ["#f6f0e5", "#c0b09a", "#e3d7c5", "#ad9e8a"];
  const tiles =
    TONES.map((tone, i) => `<div class="m-ios-tile" style="left:${COL(i % 4)}px;top:${ROW(Math.floor(i / 4))}px;background-color:${tone}"><i style="width:${BARS[i]}px"></i></div>`).join("") +
    `<div class="m-ios-dock"></div>` +
    DOCK.map((tone, i) => `<div class="m-ios-tile" style="left:${COL(i)}px;top:754px;background-color:${tone}"></div>`).join("");

  const ICON = { x: COL(2), y: ROW(3), w: 60, h: 60 }; // 211, 376
  const SHEET_H = 520, LIST_TOP = 208;        // the share sheet: its height, and where its action list starts inside it
  const ADD_TOP = 57, ADD_OFF = 832;          // the add screen: its top on the screen, and how far below it waits (its shadow included)
  const ACTIONS = [
    ["Скопировать", I.copy],
    ["В список для чтения", I.glasses],
    ["Добавить закладку", I.bookmark],
    ["Найти на странице", I.find],
    ["На экран «Домой»", I.plusApp],
  ];
  const TARGETS = [["AirDrop", "#d9d9de"], ["Сообщения", "#cfcfd5"], ["Почта", "#dddde2"], ["Заметки", "#d3d3d9"]];

  V.mocks.iosInstall = function (phone) {
    const screen = phone.querySelector(".phone-screen");
    const homeBar = phone.querySelector(".phone-home"); // the home screen has no home bar: faded while it shows
    const root = V.h(`<div class="m-ios layer">
      <div class="m-ios-home">
        ${tiles}
        <div class="m-ios-dots"><i></i><i></i><i></i></div>
        <div class="m-ios-app"><img src="${A}icon-192.png" alt=""><span>Ar Amir</span></div>
        <div class="m-ios-ping"></div>
        <div class="m-ios-ring m-ios-ring--home"></div>
      </div>
      <div class="m-ios-safari">
        <div class="m-ios-page"></div>
        <div class="m-ios-chrome">
          <div class="m-ios-pill"><span class="m-ios-aa"><small>A</small>A</span>ar-amir.com<span class="m-ios-reload">${I.reload}</span></div>
          <div class="m-ios-bar">
            <span class="m-ios-off">${I.back}</span><span class="m-ios-off">${I.forward}</span>
            <span class="m-ios-share">${I.share}<div class="m-ios-ring m-ios-ring--share"></div></span>
            <span>${I.book}</span><span>${I.tabs}</span>
          </div>
        </div>
        <div class="m-ios-dim"></div>
        <div class="m-ios-sheet">
          <div class="m-ios-grab"></div>
          <div class="m-ios-head"><img src="${A}icon-192.png" alt=""><b>Ar Amir</b><em>ar-amir.com</em><span class="m-ios-x">${I.close}</span></div>
          <div class="m-ios-rule"></div>
          <div class="m-ios-targets">${TARGETS.map(([name, tone]) => `<span><i style="background:${tone}"></i>${name}</span>`).join("")}</div>
          <div class="m-ios-list">${ACTIONS.map(([label, icon]) => `<div class="m-ios-row"><span>${label}</span>${icon}</div>`).join("")}</div>
          <div class="m-ios-ring m-ios-ring--row"></div>
        </div>
        <div class="m-ios-add">
          <div class="m-ios-nav">
            <span class="m-ios-cancel">Отменить</span>
            <span class="m-ios-title">На экран «Домой»</span>
            <span class="m-ios-ok"><span>Добавить</span><div class="m-ios-ring m-ios-ring--add"></div></span>
          </div>
          <div class="m-ios-card"><img src="${A}icon-192.png" alt=""><b>Ar Amir</b><span class="m-ios-clear">${I.clear}</span><u></u><em>ar-amir.com/app</em></div>
        </div>
      </div>
      <div class="m-ios-launch"><img src="${A}logo.png" alt=""></div>
    </div>`);
    root.querySelector(".m-ios-page").appendChild(V.shot("login-empty"));
    screen.appendChild(root);
    gsap.set(root, { autoAlpha: 0 });

    const q = (sel) => root.querySelector(sel);
    const safari = q(".m-ios-safari"), chrome = q(".m-ios-chrome"), dim = q(".m-ios-dim"), sheet = q(".m-ios-sheet"), add = q(".m-ios-add");
    const shareIcon = q(".m-ios-share svg"), targetRow = root.querySelectorAll(".m-ios-row")[ACTIONS.length - 1], okText = q(".m-ios-ok > span");
    const ringShare = q(".m-ios-ring--share"), ringRow = q(".m-ios-ring--row"), ringAdd = q(".m-ios-ring--add"), ringHome = q(".m-ios-ring--home");
    const app = q(".m-ios-app"), appIcon = q(".m-ios-app img"), appName = q(".m-ios-app span"), ping = q(".m-ios-ping");
    const launch = q(".m-ios-launch"), launchLogo = q(".m-ios-launch img");

    // Every property a step tweens gets its start value here, so a frame looks the same however it is reached.
    gsap.set(safari, { y: 0 });
    gsap.set(dim, { opacity: 0 });
    gsap.set(sheet, { y: SHEET_H + 12 });
    gsap.set(add, { y: ADD_OFF });
    gsap.set([shareIcon, okText], { opacity: 1 });
    gsap.set(ringShare, { autoAlpha: 0, scale: 1.3 });
    gsap.set(ringRow, { autoAlpha: 0, scale: 1.03 });
    gsap.set(ringAdd, { autoAlpha: 0, scale: 1.12 });
    gsap.set(ringHome, { autoAlpha: 0, scale: 1.2 });
    gsap.set(ping, { autoAlpha: 0 });
    gsap.set(app, { autoAlpha: 0 });
    gsap.set(appIcon, { scale: 0.3 });
    gsap.set(appName, { autoAlpha: 0 });
    gsap.set(launch, { autoAlpha: 0 });
    gsap.set(launchLogo, { xPercent: -50, yPercent: -50, scale: 60 / 110 }); // exactly the icon while the layer is the icon's size

    const ringIn = (tl, el, at) => tl.to(el, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "power2.out" }, at);
    const ringOut = (tl, el, at) => tl.to(el, { autoAlpha: 0, duration: 0.2, ease: "power1.out" }, at);
    // The usual answer of a system text/icon button to a touch: it dims and comes back.
    const press = (tl, el, tp) => tl.to(el, { opacity: 0.3, duration: 0.1, ease: "power1.in" }, tp + 0.24).to(el, { opacity: 1, duration: 0.2, ease: "power1.out" }, tp + 0.4);
    let barFaded = false; // build-time: is the phone's home bar faded by the latest step?

    const rowY = 844 - SHEET_H + LIST_TOP + (ACTIONS.length - 1) * 52; // 740
    const anchors = {
      share: { x: 173, y: 771, w: 44, h: 44 },
      addToHomeRow: { x: 16, y: rowY, w: 358, h: 52 },
      addButton: { x: 285, y: 68, w: 91, h: 34 },
      homeIcon: { x: ICON.x, y: ICON.y, w: ICON.w, h: ICON.h },
    };
    const mid = (r) => [r.x + r.w / 2, r.y + r.h / 2];
    // A touch on Safari is drawn ON the surface it lands on (not on the screen): the sheet that arrives next covers its
    // fading mark, and a surface that leaves takes the mark with it.
    const touch = (tl, surface, top, x, y, at) => V.tap(tl, surface, x, y - top, at);

    return {
      root,
      anchors,
      steps: {
        // Safari with the sign-in page of the app open.
        show(tl, at) {
          tl.to(root, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, at);
          return at + 0.3;
        },
        hide(tl, at) {
          tl.to(root, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, at);
          if (barFaded) tl.to(homeBar, { autoAlpha: 1, duration: 0.2, ease: "power1.out" }, at + 0.1);
          barFaded = false;
          return at + 0.3;
        },
        // «Поделиться»: the share sheet comes up over the dimmed page.
        tapShare(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, ringShare, at);
          touch(tl, chrome, 711, ...mid(anchors.share), tp);
          press(tl, shareIcon, tp);
          ringOut(tl, ringShare, tp + 0.4);
          tl.to(dim, { opacity: 0.3, duration: 0.4, ease: "power2.out" }, tp + 0.45)
            .to(sheet, { y: 0, duration: 0.5, ease: "power3.out" }, tp + 0.45);
          return tp + 0.95;
        },
        // «На экран «Домой»»: the add screen rises over the share sheet, to full height.
        tapAddToHome(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, ringRow, at);
          touch(tl, sheet, 844 - SHEET_H, 262, rowY + 26, tp); // right of the label, so the words stay readable
          tl.to(targetRow, { backgroundColor: "#dcdce1", duration: 0.08, ease: "none" }, tp + 0.24);
          ringOut(tl, ringRow, tp + 0.45);
          tl.to(dim, { opacity: 0.4, duration: 0.45, ease: "power2.out" }, tp + 0.45)
            .to(add, { y: 0, duration: 0.5, ease: "power3.out" }, tp + 0.45)
            .set(targetRow, { backgroundColor: "#ffffff" }, tp + 0.95);
          return tp + 0.95;
        },
        // «Добавить»: Safari goes away downward, the home screen is there, the new icon pops into the first free slot.
        tapAdd(tl, at) {
          const tp = at + LEAD;
          ringIn(tl, ringAdd, at);
          touch(tl, add, ADD_TOP, ...mid(anchors.addButton), tp);
          press(tl, okText, tp);
          ringOut(tl, ringAdd, tp + 0.4);
          tl.to(dim, { opacity: 0, duration: 0.3, ease: "power1.out" }, tp + 0.45)
            .to(safari, { y: 912, duration: 0.55, ease: "power3.inOut" }, tp + 0.45) // far enough for its shadow to leave too
            .to(homeBar, { autoAlpha: 0, duration: 0.2, ease: "power1.out" }, tp + 0.45)
            .to(app, { autoAlpha: 1, duration: 0.12, ease: "none" }, tp + 0.95)
            .to(appIcon, { scale: 1, duration: 0.45, ease: "back.out(1.6)" }, tp + 0.95)
            .to(appName, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, tp + 1.1)
            .to(ringHome, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "power2.out" }, tp + 1.25)
            .set(ping, { autoAlpha: 0.9, scale: 1 }, tp + 1.5)
            .to(ping, { autoAlpha: 0, scale: 1.55, duration: 0.8, ease: "power2.out" }, tp + 1.5);
          barFaded = true;
          return tp + 2.3;
        },
        // A touch on the new icon: the app opens out of it. The launch screen stays until hide().
        openIcon(tl, at) {
          tl.to(ringHome, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "power2.out" }, at); // already on after tapAdd
          V.tap(tl, screen, ...mid(anchors.homeIcon), at); // on the screen: its mark fades over the icon as the app starts to open
          tl.to(appIcon, { scale: 0.92, duration: 0.12, ease: "power1.in" }, at + 0.24)
            .to(appIcon, { scale: 1, duration: 0.08, ease: "power1.out" }, at + 0.37);
          ringOut(tl, ringHome, at + 0.38);
          tl.set(launch, { autoAlpha: 1 }, at + 0.45)
            .to(launch, { boxShadow: LAUNCH_SHADOW, duration: 0.25, ease: "power1.out" }, at + 0.45) // its shadow comes in softly
            .to(launch, { left: 0, top: 0, width: 390, height: 844, borderRadius: 50, duration: 0.45, ease: "power3.inOut" }, at + 0.45)
            .to(launchLogo, { scale: 1, duration: 0.45, ease: "power3.inOut" }, at + 0.45)
            .to(homeBar, { autoAlpha: 1, duration: 0.1, ease: "none" }, at + 0.8); // once the app covers the bottom edge
          barFaded = false;
          return at + 0.9;
        },
      },
    };
  };
})();
