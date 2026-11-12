// Harness only: plays the mock alone so it can be looked at.
V.scene({
  id: "demo-android-install", start: 0, duration: 12.5,
  html: `<div class="js-phone" style="position:absolute;left:740px;top:60px"></div>`,
  build({ tl, q }) {
    const phone = V.phone({ kind: "android", scale: 1.1 });
    q(".js-phone").appendChild(phone);
    const and = V.mocks.androidInstall(phone);
    let t = and.steps.show(tl, 0.1);        // → 0.4
    t = and.steps.tapMenu(tl, t + 0.8);     // 1.2 → 2.55
    t = and.steps.tapAddToHome(tl, t + 0.8); // 3.35 → 4.85
    t = and.steps.tapInstall(tl, t + 0.8);  // 5.65 → 8.85
    t = and.steps.openIcon(tl, t + 0.8);    // 9.65 → 11.15
    and.steps.hide(tl, t + 0.8);            // 11.95 → 12.25
  },
});
