// The right-hand poster column: what it is, the offer, the code, what to do. It never moves —
// a customer may look up at any second, and a camera needs a still code.
V.scene({
  id: "panel", layer: "persistent", start: 0, duration: 9999,
  html: (c) => `<div class="poster-frame"></div>
    <div class="f-divider"></div>
    <div class="f-panel">
      <div class="f-panel-title">Бонусная карта</div>
      <div class="f-panel-offer">${V.fmt(c.welcomeBonus)} бонусов</div>
      <div class="f-panel-offer-sub">за первую покупку</div>
      <div class="js-qr"></div>
      <div class="f-panel-act">Наведите камеру<br>телефона на код</div>
      <div class="f-panel-url">${c.url}</div>
    </div>`,
  build({ q }) {
    q(".js-qr").replaceWith(V.qr({ module: 16 }));
  },
});
