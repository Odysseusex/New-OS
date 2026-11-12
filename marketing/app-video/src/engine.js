// The whole video is ONE paused GSAP timeline; a frame is `__seek(seconds)` + a screenshot.
// A scene registers itself with V.scene({ id, start, duration, html, build }) and animates
// only inside its own <section>. Nothing here uses the clock, so a render is repeatable.
(function () {
  const V = (window.V = window.V || {});
  const scenes = [];
  const seekHooks = [];
  gsap.config({ force3D: false, nullTargetWarn: true });
  gsap.ticker.lagSmoothing(0);
  gsap.defaults({ ease: "power3.out", duration: 0.7 });

  V.scene = (def) => scenes.push(def);
  // For things a tween cannot express (typing, counters): fn(t) is called on every seek.
  V.onSeek = (fn) => seekHooks.push(fn);
  V.h = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  V.fmt = (n) => new Intl.NumberFormat("ru-RU").format(n).replace(/ /g, " ");

  V.boot = async () => {
    const stage = document.getElementById("stage");
    const master = gsap.timeline({ paused: true });
    scenes.sort((a, b) => a.start - b.start);
    let end = 0;
    for (const def of scenes) {
      const root = document.createElement("section");
      root.className = "scene";
      root.id = "scene-" + def.id;
      if (def.html) root.innerHTML = typeof def.html === "function" ? def.html(V.cfg) : def.html;
      (def.layer === "persistent" ? document.getElementById("persistent") : stage).appendChild(root);
      const tl = gsap.timeline();
      const q = (sel) => root.querySelector(sel);
      const qa = (sel) => Array.from(root.querySelectorAll(sel));
      def.build({ root, tl, q, qa, cfg: V.cfg, dur: def.duration });
      // A scene exists only inside its window (plus the overlap it asks for), so nothing
      // of it can leak into its neighbours.
      const pre = def.pre || 0;
      const post = def.post || 0;
      if (def.layer !== "persistent") {
        gsap.set(root, { autoAlpha: 0 });
        master.set(root, { autoAlpha: 1 }, Math.max(0, def.start - pre));
        master.set(root, { autoAlpha: 0 }, def.start + def.duration + post);
      }
      master.add(tl, def.start);
      end = Math.max(end, def.start + def.duration);
    }
    V.duration = V.cfg.duration || end;
    V.master = master;
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
    window.__duration = V.duration;
    window.__seek = (t) => {
      master.time(t, false);
      for (const fn of seekHooks) fn(t);
      return true;
    };
    window.__seek(0);
    window.__ready = true;
    // Opened by hand with ?play: plays in real time, in a loop (for looking at it in a browser).
    if (new URLSearchParams(location.search).has("play")) {
      const t0 = performance.now();
      const tick = () => {
        window.__seek(((performance.now() - t0) / 1000) % V.duration);
        requestAnimationFrame(tick);
      };
      document.documentElement.classList.add("preview");
      requestAnimationFrame(tick);
    }
  };
})();
