// Every figure and word that may change lives here; scenes read V.cfg, never hard-code them.
// Programme figures mirror GET /api/club/info of the live system (12.11.2026).
window.V = window.V || {};
V.cfg = {
  fps: 30,
  width: 1920,
  height: 1080,
  url: "ar-amir.com/app",
  brand: "Ar Amir",
  signInVia: "Telegram",
  levels: [
    { name: "Бронза", percent: 2 },
    { name: "Серебро", percent: 3 },
    { name: "Золото", percent: 4 },
    { name: "Платина", percent: 5 },
  ],
  maxRedeemPercent: 30,
  welcomeBonus: 5000,
  demo: { name: "Айгерим", phone: "+7 701 123 45 67", code: "482913" },
};
