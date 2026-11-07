"use client";

import { useCallback, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// The till's product grid on a touch monoblock: the cashier scrolls by dragging across the tiles,
// and every drag used to end as a tap that added a product. A press only counts as a tap when the
// finger did not travel and the page did not scroll meanwhile. Some cheap touch panels report the
// finger as a MOUSE (no native drag-scroll at all), so a mouse drag over the grid scrolls the page
// by hand too.

const TAP_SLOP = 12; // px a finger may wobble and still be a tap

function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

export function useTapGuard<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const start = useRef<{ x: number; y: number; top: number; moved: boolean; mouse: boolean; scroller: HTMLElement | null } | null>(null);
  const suppress = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const scroller = scrollerOf(ref.current);
    start.current = { x: e.clientX, y: e.clientY, top: scroller?.scrollTop ?? 0, moved: false, mouse: e.pointerType === "mouse", scroller };
    suppress.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(e.clientX - s.x, dy) > TAP_SLOP) s.moved = true;
    if (s.moved && s.mouse && e.buttons & 1 && s.scroller) s.scroller.scrollTop = s.top - dy;
  }, []);

  const onPointerUp = useCallback(() => {
    const s = start.current;
    if (s && (s.moved || Math.abs((s.scroller?.scrollTop ?? 0) - s.top) > 4)) suppress.current = true;
    start.current = null;
  }, []);

  const onPointerCancel = useCallback(() => {
    // The browser took the gesture over to scroll: whatever comes next is not a tap.
    suppress.current = true;
    start.current = null;
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppress.current) return;
    suppress.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return { ref, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } };
}

// Big «вверх / вниз» beside the grid, for a cashier who cannot (or would rather not) drag.
export function ScrollButtons({ targetRef }: { targetRef: React.RefObject<HTMLElement> }) {
  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerOf(targetRef.current);
    if (!scroller) return;
    scroller.scrollBy({ top: direction * scroller.clientHeight * 0.7, behavior: "smooth" });
  };
  const button =
    "flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-foreground shadow-card transition active:scale-95";
  return (
    <div className="pointer-events-none sticky bottom-3 z-10 hidden justify-end gap-2 pt-3 lg:flex">
      <button type="button" onClick={() => scrollBy(-1)} aria-label="Прокрутить вверх" className={`pointer-events-auto ${button}`}>
        <ChevronUp className="h-7 w-7" strokeWidth={2} />
      </button>
      <button type="button" onClick={() => scrollBy(1)} aria-label="Прокрутить вниз" className={`pointer-events-auto ${button}`}>
        <ChevronDown className="h-7 w-7" strokeWidth={2} />
      </button>
    </div>
  );
}
