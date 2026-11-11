"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export function Modal({
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A window opened over another (the till's digit pad over a form) answers alone.
      const roots = document.querySelectorAll("[data-modal-root]");
      if (roots.length > 1 && roots[roots.length - 1] !== rootRef.current) return;
      if (e.key === "Escape") onClose();
      // ⌘/Ctrl + Enter saves the window: its marked button (`data-submit`) if
      // it has one, otherwise its form — exactly as a click would.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        const root = rootRef.current;
        if (!root) return;
        const button = root.querySelector<HTMLButtonElement>("[data-submit]");
        const form = root.querySelector("form");
        if (button) {
          e.preventDefault();
          if (!button.disabled) button.click();
        } else if (form) {
          e.preventDefault();
          form.requestSubmit();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    // On a phone a window is a sheet rising from the bottom edge, as wide as the screen.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center md:px-4">
      <div
        ref={rootRef}
        data-modal-root=""
        className={`modal-sheet w-full ${width} max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 shadow-card md:max-h-[90vh] md:rounded-2xl md:p-6`}
      >
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-4 flex items-center justify-between bg-surface px-4 py-3 md:static md:m-0 md:mb-5 md:p-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground md:h-8 md:w-8"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
