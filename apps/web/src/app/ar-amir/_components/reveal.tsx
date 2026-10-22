"use client";

import { useEffect } from "react";

// Fades sections in as they scroll into view (see .s-reveal in site.css).
export function Reveal() {
  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>(".s-reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
