"use client";

import { useEffect } from "react";
import { Delete } from "lucide-react";

// An on-screen keypad for amounts at the till.
//
// It exists because the моноблок's own on-screen keyboard is slow and gets in
// the way, so the amount is never typed into an <input> at all — the value is
// rendered as plain text and driven entirely by these buttons. That is the
// whole point: an <input> (even readOnly) is what invites the OS keyboard to
// pop up.
//
// A physical keyboard still works: digits, Backspace and Enter are listened
// for on the document, so whoever prefers the real keys keeps them.
//
// Whole tenge only — no decimal point. Prices at this till are whole numbers,
// and a тиын key would be one more thing to mis-press during a queue.
const MAX_DIGITS = 9;

export function NumberPad({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        onChange(append(value, e.key));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onChange(value.slice(0, -1));
      } else if (e.key === "Enter" && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [value, onChange, onSubmit]);

  return (
    <div className="grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
        <PadButton key={digit} onClick={() => onChange(append(value, digit))}>
          {digit}
        </PadButton>
      ))}
      <PadButton onClick={() => onChange(append(value, "00"))}>00</PadButton>
      <PadButton onClick={() => onChange(append(value, "0"))}>0</PadButton>
      <PadButton onClick={() => onChange(value.slice(0, -1))} label="Стереть">
        <Delete className="h-5 w-5" strokeWidth={1.75} />
      </PadButton>
    </div>
  );
}

// Leading zeros are dropped, so tapping 0 then 5 gives "5" rather than "05".
function append(value: string, digits: string): string {
  const next = (value + digits).replace(/^0+(?=\d)/, "");
  return next.slice(0, MAX_DIGITS);
}

function PadButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-14 items-center justify-center rounded-xl border border-border bg-surface text-xl font-medium text-foreground transition hover:bg-surface-muted active:scale-[0.97]"
    >
      {children}
    </button>
  );
}
