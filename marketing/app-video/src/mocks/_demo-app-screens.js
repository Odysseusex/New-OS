// Harness only: plays both mocks on one phone so they can be looked at.
V.scene({
  id: "demo-app-screens", start: 0, duration: 22.5,
  html: `<div class="js-phone" style="position:absolute;left:740px;top:60px"></div>`,
  build({ tl, q }) {
    const phone = V.phone({ kind: "iphone", scale: 1.1 });
    q(".js-phone").appendChild(phone);
    const login = V.mocks.appLogin(phone);
    const card = V.mocks.appCard(phone);

    let t = login.steps.show(tl, 0.2);               //  0.2 →  0.6
    t = login.steps.typeNumber(tl, t + 0.6);         //  1.2 →  3.7
    t = login.steps.fillRest(tl, t + 0.5);           //  4.2 →  7.75
    t = login.steps.tapContinue(tl, t + 0.6);        //  8.35 → 9.95
    t = login.steps.tapOpenTelegram(tl, t + 0.8);    // 10.75 → 12.1
    t = login.steps.hide(tl, t + 0.5);               // 12.6 → 12.9

    t = card.steps.show(tl, t + 0.2, { balance: "zero" }); // 13.1 → 13.6
    t = card.steps.addBonus(tl, t + 0.8);            // 14.4 → 15.6
    t = card.steps.scrollToQr(tl, t + 0.8);          // 16.4 → 17.3
    t = card.steps.scan(tl, t + 0.5);                // 17.8 → 19.4
    t = card.steps.scrollToTop(tl, t + 0.7);         // 20.1 → 20.9
    card.steps.hide(tl, t + 0.8);                    // 21.7 → 22.0
  },
});
