// Harness only: plays the mock alone so it can be looked at.
V.scene({
  id: "demo-camera-scan", start: 0, duration: 4,
  html: `<div class="js-phone" style="position:absolute;left:740px;top:60px"></div>`,
  build({ tl, q }) {
    const phone = V.phone({ kind: "iphone", scale: 1.1 });
    q(".js-phone").appendChild(phone);
    const cam = V.mocks.cameraScan(phone);
    let t = cam.steps.show(tl, 0.1);
    t = cam.steps.aim(tl, t);
    t = cam.steps.recognise(tl, t + 0.1);
    t = cam.steps.tapLink(tl, t + 0.5);
    cam.steps.hide(tl, 3.6);
  },
});
