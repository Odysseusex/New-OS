// Harness only: plays the mock alone so it can be looked at.
V.scene({
  id: "demo-telegram-login", start: 0, duration: 10.3,
  html: `<div class="js-phone" style="position:absolute;left:740px;top:60px"></div>`,
  build({ tl, q }) {
    const phone = V.phone({ kind: "iphone", scale: 1.1 });
    q(".js-phone").appendChild(phone);
    const tg = V.mocks.telegramLogin(phone);
    let t = tg.steps.show(tl, 0.2);          // 0.2 → 0.5
    t = tg.steps.tapStart(tl, t + 0.8);      // 1.3 → 3.3  (the touch at 2.0)
    t = tg.steps.tapSendNumber(tl, t + 0.8); // 4.1 → 5.6  (the touch at 4.8)
    t = tg.steps.tapShare(tl, t + 0.8);      // 6.4 → 8.8  (the touch at 7.1)
    tg.steps.hide(tl, t + 0.8);              // 9.6 → 9.9
  },
});
