// Shared building blocks. Scenes compose these; they do not restyle them.
(function () {
  const V = (window.V = window.V || {});
  const A = "../assets/";

  const SIGNAL = '<svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>';
  const WIFI = '<svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1.5 4.2a10 10 0 0 1 14 0"/><path d="M4.3 7a6 6 0 0 1 8.4 0"/><circle cx="8.5" cy="10.2" r="1.1" fill="currentColor" stroke="none"/></svg>';
  const BATTERY = '<svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.75" y="0.75" width="22.5" height="11.5" rx="3.6" stroke="currentColor" stroke-opacity=".45" stroke-width="1.5"/><rect x="2.6" y="2.6" width="18.8" height="7.8" rx="2" fill="currentColor"/><path d="M25 4.4v4.2c.9-.3 1.5-1.1 1.5-2.1S25.900 4.700 25 4.400z" fill="currentColor" fill-opacity=".5"/></svg>';

  // A phone. kind: "iphone" | "android". The screens go into .phone-view (390 × 797,
  // under the status bar) or .phone-screen (390 × 844, for full-bleed things).
  V.phone = ({ kind = "iphone", scale = 1, cls = "" } = {}) =>
    V.h(`<div class="phone phone--${kind} ${cls}" style="--s:${scale}">
      <div class="phone-body">
        <div class="phone-screen">
          <div class="phone-status"><span>9:41</span><span class="icons">${SIGNAL}${WIFI}${BATTERY}</span></div>
          <div class="phone-view"></div>
          <div class="phone-home"></div>
        </div>
        <div class="phone-island"></div>
      </div>
    </div>`);

  // A real screen of the app: assets/app/<name>.png, 390 pt wide.
  V.shot = (name, cls = "") => V.h(`<img class="shot ${cls}" src="${A}app/${name}.png" alt="">`);

  // The QR for ar-amir.com/app. `module` = screen pixels per QR module (keep it whole).
  V.qr = ({ module = 16, logo = true } = {}) => {
    const n = 29, pad = 2 * module, size = n * module;
    const k = 7 * module;
    return V.h(`<div class="qr" style="width:${size + 2 * pad}px;height:${size + 2 * pad}px;padding:${pad}px">
      <img class="qr-code" src="${A}qr-app-plain.svg" alt="">
      ${logo ? `<span class="qr-logo" style="width:${k + module}px;height:${k + module}px"><img src="${A}icon-192.png" width="${k}" height="${k}" alt=""></span>` : ""}
    </div>`);
  };

  // A touch at (x, y) in `container`'s own coordinates, at timeline time `at`.
  V.tap = (tl, container, x, y, at) => {
    const el = V.h('<span class="tap"><b></b><i></i></span>');
    el.style.left = x + "px";
    el.style.top = y + "px";
    container.appendChild(el);
    const dot = el.querySelector("i"), ring = el.querySelector("b");
    gsap.set([dot, ring], { autoAlpha: 0, scale: 0.5 });
    tl.to(dot, { autoAlpha: 1, scale: 1, duration: 0.2, ease: "power2.out" }, at)
      .to(dot, { scale: 0.82, duration: 0.14, ease: "power2.in" }, at + 0.24)
      .set(ring, { autoAlpha: 0.9, scale: 0.8 }, at + 0.22)
      .to(ring, { autoAlpha: 0, scale: 1.9, duration: 0.4, ease: "power2.out" }, at + 0.22)
      .to(dot, { autoAlpha: 0, scale: 1.1, duration: 0.22, ease: "power1.out" }, at + 0.42);
    return el;
  };

  // Dark screens (camera, a dimmed sheet) want a white status bar and home bar; `on` = white.
  // A reversible set, so any frame can be rendered on its own.
  V.statusLight = (tl, phone, at, on) => {
    tl.set(phone.querySelector(".phone-status"), { color: on ? "#ffffff" : "#1f1712" }, at);
    tl.set(phone.querySelector(".phone-home"), { backgroundColor: on ? "rgba(255,255,255,0.9)" : "rgba(31,23,18,0.85)" }, at);
  };

  // A rectangle given in the phone's own points (origin: top-left of .phone-screen) → frame pixels.
  // Reads the layout, not transforms: call it at build time, before the phone is tweened.
  V.onStage = (phone, r) => {
    const s = parseFloat(getComputedStyle(phone).getPropertyValue("--s")) || 1;
    let x = 0, y = 0;
    for (let el = phone; el && el.id !== "frame"; el = el.offsetParent) { x += el.offsetLeft; y += el.offsetTop; }
    const b = 13 * s;
    return { x: x + b + r.x * s, y: y + b + r.y * s, w: (r.w || 0) * s, h: (r.h || 0) * s };
  };

  V.logo = (size = 150) => V.h(`<img class="logo" src="${A}logo.png" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.225)}px" alt="">`);
})();
