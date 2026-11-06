"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Delete } from "lucide-react";
import { Modal } from "@/components/modal";

// The till's own digit pad: big buttons for a touch monoblock whose system keyboard is switched
// off. There is no <input> behind it, so nothing makes the system keyboard pop up; a physical
// keyboard (or a barcode scanner) still types into it.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

// True when the element sits in the window on top (a pad opened over a form answers alone).
export function isInTopWindow(el: HTMLElement | null): boolean {
  const roots = document.querySelectorAll("[data-modal-root]");
  if (!el || roots.length === 0) return true;
  return roots[roots.length - 1].contains(el);
}

export function usePhysicalKeys(onDigit: (d: string) => void, onBackspace: () => void, onEnter: () => void, scope?: RefObject<HTMLElement>) {
  const handlers = useRef({ onDigit, onBackspace, onEnter });
  handlers.current = { onDigit, onBackspace, onEnter };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (scope && !isInTopWindow(scope.current)) return;
      // A real field in the same window keeps its own typing; one behind the window (the till's
      // scan field keeps focus) does not.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && scope?.current) {
        const roots = document.querySelectorAll("[data-modal-root]");
        if (roots.length && roots[roots.length - 1].contains(t)) return;
      }
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
  }, [scope]);
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
  const scope = useRef<HTMLDivElement>(null);
  usePhysicalKeys(add, back, submit, scope);

  return (
    <Modal title={title} onClose={onClose} width="max-w-sm">
      <div
        ref={scope}
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

// «1234.5» → «1 234,5» while typed (a trailing comma stays visible).
function shownNumber(text: string) {
  const [whole, frac] = text.split(".");
  const w = Number(whole || "0").toLocaleString("ru-RU");
  return frac === undefined ? w : `${w},${frac}`;
}

// A whole number typed on the pad (e.g. points to spend, a year), with an optional upper limit.
export function NumberKeypadModal({
  title,
  initial,
  max = Number.MAX_SAFE_INTEGER,
  unit,
  maxDigits = 9,
  plain = false,
  decimal = false,
  onDone,
  onClose,
}: {
  // A comma key for parts (кг, %, тиын); two places after it at most.
  decimal?: boolean;
  title: string;
  initial: number;
  max?: number;
  unit?: string;
  maxDigits?: number;
  // A code-like number (a year): no thousands separator, no «Макс.» key, no limit line.
  plain?: boolean;
  onDone: (value: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial > 0 ? String(decimal ? initial : Math.floor(initial)) : "");
  const set = (next: string) => setText(next.replace(/^0+(?=\d)/, ""));
  const value = text === "" || text === "." ? 0 : Number(text);
  const over = value > max;
  const add = (d: string) => {
    if (d === "." || d === ",") {
      if (decimal && !text.includes(".")) set((text || "0") + ".");
      return;
    }
    const [whole, frac] = text.split(".");
    if (frac !== undefined ? frac.length < 2 : whole.length < maxDigits) set(text + d);
  };
  const back = () => set(text.slice(0, -1));
  const done = () => onDone(Math.min(value, max));
  const scope = useRef<HTMLDivElement>(null);
  usePhysicalKeys(add, back, done, scope);

  return (
    <Modal title={title} onClose={onClose} width="max-w-sm">
      <div ref={scope} className="mb-1 rounded-2xl border border-border bg-surface-muted px-4 py-4 text-center text-[1.65rem] font-semibold tabular-nums text-foreground">
        {text === "" ? (plain ? "—" : "0") : plain ? text : shownNumber(text)}
        {unit && <span className="ml-2 text-base font-medium text-muted">{unit}</span>}
      </div>
      {plain || max === Number.MAX_SAFE_INTEGER ? (
        <div className="mb-3" />
      ) : (
        <p className={clsx("mb-3 text-center text-sm", over ? "text-red-600" : "text-muted")}>
          Не больше {max.toLocaleString("ru-RU")}
        </p>
      )}
      <NumericKeypad
        onDigit={add}
        onBackspace={back}
        onClear={() => set("")}
        extraKey={
          decimal
            ? { label: ",", onPress: () => add(".") }
            : plain || max === Number.MAX_SAFE_INTEGER
              ? undefined
              : { label: "Макс.", onPress: () => set(String(Math.floor(max))) }
        }
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

// A code-like number field for the till (a year): looks like an input, opens the digit pad.
export function DigitsField({
  value,
  onChange,
  title,
  maxDigits,
  placeholder = "—",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
  maxDigits: number;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "w-full rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm tabular-nums transition hover:bg-surface-muted",
          className,
        )}
      >
        {value ? <span className="text-foreground">{value}</span> : <span className="text-muted">{placeholder}</span>}
      </button>
      {open && (
        <NumberKeypadModal
          title={title}
          initial={value ? Number(value) : 0}
          maxDigits={maxDigits}
          plain
          onClose={() => setOpen(false)}
          onDone={(v) => {
            onChange(v > 0 ? String(v) : "");
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// An amount field for the till (money, a percent, a quantity): looks like an input, opens the pad.
// `value` is the typed text («1500», «2.5»); empty = nothing typed.
export function AmountField({
  value,
  onChange,
  title,
  unit,
  decimal = false,
  max,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
  unit?: string;
  decimal?: boolean;
  max?: number;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const n = Number(value.replace(",", "."));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-lg tabular-nums transition hover:bg-surface-muted",
          className,
        )}
      >
        {value !== "" && Number.isFinite(n) ? (
          <span className="text-foreground">
            {shownNumber(String(n))}
            {unit ? ` ${unit}` : ""}
          </span>
        ) : (
          <span className="text-muted">{placeholder ?? "Нажмите, чтобы ввести"}</span>
        )}
      </button>
      {open && (
        <NumberKeypadModal
          title={title}
          initial={Number.isFinite(n) ? n : 0}
          unit={unit}
          decimal={decimal}
          max={max}
          onClose={() => setOpen(false)}
          onDone={(v) => {
            onChange(String(v));
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// A PIN typed on the till's pad, shown as dots. Enter (a physical keyboard) submits its form.
export function PinPad({ value, onChange, maxLength = 6 }: { value: string; onChange: (v: string) => void; maxLength?: number }) {
  const scope = useRef<HTMLDivElement>(null);
  usePhysicalKeys(
    (d) => {
      if (value.length < maxLength) onChange(value + d);
    },
    () => onChange(value.slice(0, -1)),
    () => scope.current?.closest("form")?.requestSubmit(),
    scope,
  );
  return (
    <div ref={scope} className="mx-auto max-w-xs">
      <div className="mb-3 flex h-12 items-center justify-center gap-3 rounded-2xl border border-border bg-surface-muted" aria-label="PIN">
        {value.length === 0 ? (
          <span className="text-sm text-muted">PIN</span>
        ) : (
          Array.from({ length: value.length }, (_, i) => <span key={i} className="h-3 w-3 rounded-full bg-foreground" />)
        )}
      </div>
      <NumericKeypad onDigit={(d) => value.length < maxLength && onChange(value + d)} onBackspace={() => onChange(value.slice(0, -1))} onClear={() => onChange("")} />
    </div>
  );
}
