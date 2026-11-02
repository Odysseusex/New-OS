"use client";

import { useEffect, useState } from "react";
import type React from "react";

// Keyboard flow for documents with many lines (Приёмка, Списание, заказ
// поставщику, продажа…), so a long delivery note can be typed without
// reaching for the screen:
//   · Enter in a marked field moves to the next marked field of the same form
//     (product → quantity → price → the next line's product, whose search opens);
//   · ⌘/Ctrl + Enter anywhere in a modal saves it (Modal handles that);
//   · a line always has an empty line after it, so «Добавить» is never needed.
//
// A field joins the flow with `{...enterNext}` (or `data-enter`); a product
// picker joins with `data-enter="open"` and is opened instead of focused.

export const ENTER_ATTR = "data-enter";

function flowFields(from: HTMLElement): HTMLElement[] {
  const scope = from.closest("form, [data-modal-root]") ?? document.body;
  return Array.from(scope.querySelectorAll<HTMLElement>(`[${ENTER_ATTR}]`)).filter(
    (el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0,
  );
}

// Moves to the field after `from`. Returns false at the end of the form.
export function focusNextField(from: HTMLElement): boolean {
  const fields = flowFields(from);
  const next = fields[fields.indexOf(from) + 1];
  if (!next) return false;
  if (next.getAttribute(ENTER_ATTR) === "open") {
    next.focus();
    next.click();
  } else {
    next.focus();
    if (next instanceof HTMLInputElement && next.type !== "date") next.select();
  }
  return true;
}

function onEnterNext(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.nativeEvent.isComposing) return;
  // A bare Enter in a form field would otherwise submit the whole document.
  e.preventDefault();
  focusNextField(e.currentTarget);
}

export const enterNext = { [ENTER_ATTR]: "", onKeyDown: onEnterNext } as const;

// The rows of a multi-line document always end with exactly one empty row: as
// soon as the last row gets a product, a new empty one is added after it.
export function withTrailingRow<T>(rows: T[], isEmpty: (row: T) => boolean, make: () => T, max = Infinity): T[] {
  if (rows.length === 0) return [make()];
  if (rows.length >= max || isEmpty(rows[rows.length - 1])) return rows;
  return [...rows, make()];
}

// «⌘↵» on Apple keyboards (iPad, Mac), «Ctrl+↵» elsewhere (the Windows monoblock).
export function useSubmitShortcutLabel(): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const apple = /Mac|iPad|iPhone|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
    setLabel(apple ? "⌘↵" : "Ctrl+↵");
  }, []);
  return label;
}
