"use client";

import { useEffect } from "react";

// Phone only. Pages are written once, for a laptop; two things make their tables and tab bars
// comfortable on a phone without rewriting a hundred of them:
//  · every ordinary table becomes a list of cards — each cell is given its column's heading
//    (`data-label`, shown by CSS in globals.css), so nothing scrolls sideways;
//    a wide grid (many columns, e.g. ДДС по месяцам) stays a table, scrolling inside its own box
//    with the first column held in place;
//  · the tab that was pressed is brought into view in its one-line strip.
// Only attributes are added (React never touches unknown `data-*` attributes), no nodes.
const PHONE = "(max-width: 767px)";
const MAX_CARD_COLUMNS = 8;

function label(table: HTMLTableElement) {
  const headRows = table.tHead?.rows;
  const head = headRows && headRows.length === 1 ? Array.from(headRows[0].cells) : null;
  const spans = head ? head.some((c) => c.colSpan > 1) : true;
  const mode = table.dataset.wide !== undefined || !head || spans || head.length > MAX_CARD_COLUMNS ? "wide" : "cards";
  if (table.dataset.m !== mode) table.dataset.m = mode;
  if (mode !== "cards" || !head) return;
  const names = head.map((c) => (c.textContent ?? "").trim());
  const sections = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const section of sections) {
    for (const row of Array.from(section.rows)) {
      // A row with merged cells (an empty-list note, an opened detail) is shown as it is.
      if (Array.from(row.cells).some((c) => c.colSpan > 1)) continue;
      Array.from(row.cells).forEach((cell, i) => {
        const name = names[i] ?? "";
        if (cell.getAttribute("data-label") !== name) cell.setAttribute("data-label", name);
      });
    }
  }
}

export function MobileEnhancer() {
  useEffect(() => {
    const media = window.matchMedia(PHONE);
    let frame = 0;
    const run = () => {
      frame = 0;
      if (!media.matches) return;
      document.querySelectorAll<HTMLTableElement>("table").forEach(label);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    media.addEventListener("change", schedule);
    schedule();

    const onClick = (e: MouseEvent) => {
      if (!media.matches) return;
      const button = (e.target as HTMLElement | null)?.closest?.("button, a");
      const strip = button?.parentElement;
      if (button && strip?.matches(".bg-surface-muted.p-1")) {
        button.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      }
    };
    document.addEventListener("click", onClick);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", schedule);
      document.removeEventListener("click", onClick);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
