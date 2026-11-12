// MOCK: the phone's camera reading the QR on the till's screen.
//   const cam = V.mocks.cameraScan(phone);
//   let t = cam.steps.show(tl, 0);          // the camera appears (hidden until then)
//   t = cam.steps.aim(tl, t);               // the view settles on the code, the brackets close on it
//   t = cam.steps.recognise(tl, t + 0.1);   // the yellow link «ar-amir.com» appears
//   t = cam.steps.tapLink(tl, t + 0.5);     // a touch on the link
//   t = cam.steps.hide(tl, t);              // the camera fades away
// Every step adds its tweens to `tl` at `at` and returns the time it ends.
// anchors: rectangles in the phone's own points (origin: top-left of .phone-screen, 390 × 844).
(function () {
  const V = window.V;
  V.mocks = V.mocks || {};
  const COMPASS = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#1c1a12" stroke-width="2"/><path d="M15.8 8.2l-2.2 5.4-5.400 2.200 2.200-5.400z" fill="#1c1a12"/></svg>';

  V.mocks.cameraScan = function (phone) {
    const screen = phone.querySelector(".phone-screen");
    const root = V.h(`<div class="m-cam layer">
      <div class="m-cam-world">
        <div class="m-cam-title">Бонусная карта</div>
        <div class="m-cam-code"><img src="../assets/qr-app-plain.svg" alt=""></div>
        <div class="m-cam-url">${V.cfg.url}</div>
      </div>
      <div class="m-cam-vignette"></div>
      <div class="m-cam-focus"><i></i><i></i><i></i><i></i></div>
      <div class="m-cam-link">${COMPASS}<span>ar-amir.com</span></div>
      <div class="m-cam-top"></div>
      <div class="m-cam-bottom"><div class="m-cam-modes"><span>Видео</span><b>Фото</b><span>Портрет</span></div><div class="m-cam-shutter"></div></div>
    </div>`);
    screen.appendChild(root);
    gsap.set(root, { autoAlpha: 0 });
    const world = root.querySelector(".m-cam-world");
    const focus = root.querySelector(".m-cam-focus");
    const link = root.querySelector(".m-cam-link");
    gsap.set(focus, { autoAlpha: 0, scale: 1.25 });
    gsap.set(link, { autoAlpha: 0, y: 14, scale: 0.9, xPercent: -50, x: 0 });
    link.style.transform = ""; // GSAP owns the centring from here

    return {
      root,
      anchors: { code: { x: 62, y: 228, w: 266, h: 266 }, link: { x: 110, y: 512, w: 170, h: 46 } },
      steps: {
        // The camera is a dark, full-bleed screen: white status bar while it is up.
        show(tl, at) {
          tl.to(root, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, at);
          V.statusLight(tl, phone, at, true);
          return at + 0.3;
        },
        hide(tl, at) {
          tl.to(root, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, at);
          V.statusLight(tl, phone, at + 0.15, false);
          return at + 0.3;
        },
        // A hand bringing the phone up: the picture drifts and settles, then the brackets close on the code.
        aim(tl, at) {
          tl.fromTo(world, { x: 46, y: -58, rotation: -4, scale: 0.9 }, { x: 0, y: 0, rotation: 0, scale: 1, duration: 1.1, ease: "power2.out" }, at)
            .to(focus, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2.2)" }, at + 0.95);
          return at + 1.3;
        },
        recognise(tl, at) {
          tl.to(focus, { scale: 0.96, duration: 0.12, ease: "power1.in" }, at)
            .to(focus, { scale: 1, duration: 0.2, ease: "power1.out" }, at + 0.12)
            .to(link, { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: "back.out(1.8)" }, at + 0.1);
          return at + 0.5;
        },
        tapLink(tl, at) {
          V.tap(tl, screen, 195, 535, at);
          tl.to(link, { scale: 0.94, duration: 0.12, ease: "power1.in" }, at + 0.24).to(link, { scale: 1, duration: 0.16 }, at + 0.36);
          return at + 0.8;
        },
      },
    };
  };
})();
