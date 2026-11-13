// Harness only: plays the mock alone so it can be looked at.
V.scene({
  id: "demo-android-install", start: 0, duration: 13.2,
  html: `<div class="js-phone" style="position:absolute;left:740px;top:60px"></div>`,
  build({ tl, q }) {
    const phone = V.phone({ kind: "android", scale: 1.1 });
    q(".js-phone").appendChild(phone);
    const and = V.mocks.androidInstall(phone);
    let t = and.steps.show(tl, 0.1);        // → 0.4
    t = and.steps.tapMenu(tl, t + 0.8);     // 1.2 → 2.7
    t = and.steps.tapAddToHome(tl, t + 0.8); // 3.5 → 5.15
    t = and.steps.tapInstall(tl, t + 0.8);  // 5.95 → 9.3
    t = and.steps.openIcon(tl, t + 0.8);    // 10.1 → 11.75
    and.steps.hide(tl, t + 0.8);            // 12.55 → 12.85
  },
});
