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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-2 sm:px-4">
      <div
        ref={rootRef}
        data-modal-root=""
        className={`w-full ${width} max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-6`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
