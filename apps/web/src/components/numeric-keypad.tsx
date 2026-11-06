"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Delete } from "lucide-react";
import { Modal } from "@/components/modal";

// The till's own digit pad: big buttons for a touch monoblock whose system keyboard is switched
// off. There is no <input> behind it, so nothing makes the system keyboard pop up; a physical
// keyboard (or a barcode scanner) still types into it.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function usePhysicalKeys(onDigit: (d: string) => void, onBackspace: () => void, onEnter: () => void) {
  const handlers = useRef({ onDigit, onBackspace, onEnter });
  handlers.current = { onDigit, onBackspace, onEnter };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handlers.current.onDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handlers.current.onBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handlers.current.onEnter();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

const keyClass =
  "flex h-16 select-none items-center justify-center rounded-2xl border border-border bg-surface text-2xl font-semibold text-foreground transition active:scale-[0.97] active:bg-surface-muted hover:bg-surface-muted disabled:opacity-40";

export function NumericKeypad({
  onDigit,
  onBackspace,
  onClear,
  extraKey,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  // Bottom-left key; «Очистить» when not given.
  extraKey?: { label: string; onPress: () => void };
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button key={k} type="button" onClick={() => onDigit(k)} className={keyClass}>
          {k}
        </button>
      ))}
      <button type="button" onClick={extraKey ? extraKey.onPress : onClear} className={clsx(keyClass, "text-base font-medium text-muted")}>
        {extraKey ? extraKey.label : "Очистить"}
      </button>
      <button type="button" onClick={() => onDigit("0")} className={keyClass}>
        0
      </button>
      <button type="button" onClick={onBackspace} aria-label="Стереть" className={keyClass}>
        <Delete className="h-6 w-6" strokeWidth={1.75} />
      </button>
    </div>
  );
}

// A Kazakhstan mobile number after «+7»: ten digits, shown as +7 (7__) ___ __ __ while typed.
export const PHONE_DIGITS = 10;

function phoneMask(digits: string) {
  const d = digits.padEnd(PHONE_DIGITS, "_");
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

export function PhoneKeypadModal({
  title,
  digits,
  onDigitsChange,
  onSubmit,
  onClose,
  submitLabel,
  busy,
  error,
  children,
}: {
  title: string;
  digits: string;
  onDigitsChange: (digits: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  // Below the pad: e.g. «Номер не зарегистрирован · Зарегистрировать».
  children?: React.ReactNode;
}) {
  const complete = digits.length === PHONE_DIGITS;
  const add = (d: string) => {
    if (digits.length >= PHONE_DIGITS) return;
    // The national part starts with 7; a habitual leading 8 (8 701 …) is not part of it.
    if (digits.length === 0 && d === "8") return;
    onDigitsChange(digits + d);
  };
  const back = () => onDigitsChange(digits.slice(0, -1));
  const submit = () => {
    if (complete && !busy) onSubmit();
  };
  usePhysicalKeys(add, back, submit);

  return (
    <Modal title={title} onClose={onClose} width="max-w-sm">
      <div
        className={clsx(
          "mb-4 rounded-2xl border bg-surface-muted px-4 py-4 text-center text-[1.75rem] font-semibold tracking-wide tabular-nums",
          error ? "border-red-300 text-red-700" : "border-border text-foreground",
        )}
      >
        {phoneMask(digits)}
      </div>
      <NumericKeypad onDigit={add} onBackspace={back} onClear={() => onDigitsChange("")} />
      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}
      {children}
      <button
        type="button"
        data-submit
        onClick={submit}
        disabled={!complete || busy}
        className="mt-4 h-14 w-full rounded-2xl bg-accent text-lg font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "…" : submitLabel}
      </button>
    </Modal>
  );
}

// A whole number typed on the pad (e.g. points to spend), with an upper limit.
export function NumberKeypadModal({
  title,
  initial,
  max,
  unit,
  onDone,
  onClose,
}: {
  title: string;
  initial: number;
  max: number;
  unit?: string;
  onDone: (value: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial > 0 ? String(Math.floor(initial)) : "");
  const set = (next: string) => setText(next.replace(/^0+(?=\d)/, ""));
  const value = text === "" ? 0 : Number(text);
  const over = value > max;
  const add = (d: string) => {
    if (text.length < 9) set(text + d);
  };
  const back = () => set(text.slice(0, -1));
  const done = () => onDone(Math.min(value, max));
  usePhysicalKeys(add, back, done);

  return (
    <Modal title={title} onClose={onClose} width="max-w-sm">
      <div className="mb-1 rounded-2xl border border-border bg-surface-muted px-4 py-4 text-center text-[1.65rem] font-semibold tabular-nums text-foreground">
        {text === "" ? "0" : Number(text).toLocaleString("ru-RU")}
        {unit && <span className="ml-2 text-base font-medium text-muted">{unit}</span>}
      </div>
      <p className={clsx("mb-3 text-center text-sm", over ? "text-red-600" : "text-muted")}>
        Не больше {max.toLocaleString("ru-RU")}
      </p>
      <NumericKeypad
        onDigit={add}
        onBackspace={back}
        onClear={() => set("")}
        extraKey={{ label: "Макс.", onPress: () => set(String(Math.floor(max))) }}
      />
      <button
        type="button"
        data-submit
        onClick={done}
        className="mt-4 h-14 w-full rounded-2xl bg-accent text-lg font-semibold text-accent-foreground transition hover:opacity-90"
      >
        Готово
      </button>
    </Modal>
  );
}

// The ten digits after «+7» of whatever was stored («+77011234567», «8 701 …», «701…»).
export function phoneDigitsOf(value: string): string {
  let d = value.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) d = d.slice(1);
  return d.slice(0, PHONE_DIGITS);
}

// A phone field for the till: looks like an input, opens the pad. `onChange` gets «+7…».
export function PhoneField({
  value,
  onChange,
  title = "Телефон клиента",
  submitLabel = "Готово",
  onSubmit,
  className,
}: {
  value: string;
  onChange: (phone: string) => void;
  title?: string;
  submitLabel?: string;
  // Called with the full number when the pad's button is pressed (after onChange).
  onSubmit?: (phone: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState("");
  const shown = phoneDigitsOf(value);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDigits(shown);
          setOpen(true);
        }}
        className={clsx(
          "w-full rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm tabular-nums transition hover:bg-surface-muted",
          className,
        )}
      >
        {shown ? <span className="text-foreground">{phoneMask(shown).replace(/_/g, "")}</span> : <span className="text-muted">Телефон клиента</span>}
      </button>
      {open && (
        <PhoneKeypadModal
          title={title}
          digits={digits}
          onDigitsChange={setDigits}
          submitLabel={submitLabel}
          onClose={() => setOpen(false)}
          onSubmit={() => {
            const full = `+7${digits}`;
            onChange(full);
            setOpen(false);
            onSubmit?.(full);
          }}
        />
      )}
    </>
  );
}
