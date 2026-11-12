// Harness only: plays the mock alone so it can be looked at.
V.scene({
  id: "demo-ios-install", start: 0, duration: 12.6,
  html: `<div class="js-phone" style="position:absolute;left:740px;top:60px"></div>`,
  build({ tl, q }) {
    const phone = V.phone({ kind: "iphone", scale: 1.1 });
    q(".js-phone").appendChild(phone);
    const ios = V.mocks.iosInstall(phone);
    const pause = 0.8;
    let t = ios.steps.show(tl, 0.1);            // 0.10 → 0.40
    t = ios.steps.tapShare(tl, t + pause);      // 1.20 → 2.85
    t = ios.steps.tapAddToHome(tl, t + pause);  // 3.65 → 5.30
    t = ios.steps.tapAdd(tl, t + pause);        // 6.10 → 9.10
    t = ios.steps.openIcon(tl, t + pause);      // 9.90 → 10.80
    ios.steps.hide(tl, t + pause);              // 11.60 → 11.90
  },
});
