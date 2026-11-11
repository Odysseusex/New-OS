"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowBigUp, Delete } from "lucide-react";
import { Modal } from "@/components/modal";
import { isInTopWindow } from "@/components/numeric-keypad";

// The till's own letter keyboard (names, relations) for a touch monoblock whose system keyboard
// is switched off — full-width keys, Russian ЙЦУКЕН plus the Kazakh letters. No <input> behind
// it; a physical keyboard still types into it.

// The standard Kazakh layout (as on Windows / iPad): Kazakh letters on the top row, then ЙЦУКЕН.
const ROWS = [
  ["ә", "і", "ң", "ғ", "ү", "ұ", "қ", "ө", "һ"],
  ["й", "ц", "у", "к", "е", "н", "г", "ш", "щ", "з", "х", "ъ"],
  ["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "э", "ё"],
  ["я", "ч", "с", "м", "и", "т", "ь", "б", "ю"],
];

const key =
  "flex h-14 min-w-0 flex-1 select-none items-center justify-center rounded-xl border border-border bg-surface text-xl font-medium text-foreground transition active:scale-[0.96] active:bg-surface-muted hover:bg-surface-muted";

// A capital at the start of each word (names), unless the cashier flips it with ⇧.
const startsWord = (text: string) => text === "" || /[\s-]$/.test(text);

export function TextKeypadModal({
  title,
  initial = "",
  maxLength = 100,
  placeholder,
  withDigits = false,
  lowercase = false,
  live,
  onDone,
  onClose,
}: {
  // No automatic capitals (a search: case does not matter, small letters read easier).
  lowercase?: boolean;
  // Shown between the typed text and the keys, recomputed as the text changes (the till's
  // product search lists matches here).
  live?: (text: string) => ReactNode;
  title: string;
  // A row of digits on top (comments: «Инкассация 2»), not needed for names.
  withDigits?: boolean;
  initial?: string;
  maxLength?: number;
  placeholder?: string;
  onDone: (value: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [shift, setShift] = useState(false);
  // Names start each word with a capital; free text only the first word.
  const upper = (lowercase ? false : withDigits ? text === "" : startsWord(text)) !== shift;

  const add = (ch: string) => {
    setText((t) => (t.length >= maxLength ? t : t + ch));
    setShift(false);
  };
  const back = () => setText((t) => t.slice(0, -1));
  const done = () => onDone(text.replace(/\s+/g, " ").trim());

  const handlers = useRef({ add, back, done });
  handlers.current = { add, back, done };
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isInTopWindow(scope.current)) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        handlers.current.back();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handlers.current.done();
      } else if (e.key.length === 1) {
        e.preventDefault();
        handlers.current.add(e.key);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const letter = (l: string) => (upper ? l.toUpperCase() : l);

  return (
    <Modal title={title} onClose={onClose} width="max-w-4xl">
      <div ref={scope} className="mb-4 flex min-h-[3.75rem] items-center rounded-2xl border border-border bg-surface-muted px-4 py-3 text-2xl font-semibold text-foreground">
        {text ? <span className="break-all">{text}</span> : <span className="text-muted">{placeholder}</span>}
        <span className="ml-0.5 inline-block h-7 w-0.5 animate-pulse bg-accent" />
      </div>
      {live?.(text)}
      <div className="space-y-2">
        {withDigits && (
          <div className="flex gap-1.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => (
              <button key={d} type="button" onClick={() => add(d)} className={clsx(key, "h-12 text-lg")}>
                {d}
              </button>
            ))}
          </div>
        )}
        {ROWS.map((row, i) => (
          <div key={i} className={clsx("flex gap-1.5", i === 0 && "px-[12%]", i === 2 && "px-[2%]", i === 3 && "px-[12%]")}>
            {row.map((l) => (
              <button key={l} type="button" onClick={() => add(letter(l))} className={key}>
                {letter(l)}
              </button>
            ))}
          </div>
        ))}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setShift((s) => !s)}
            aria-label="Заглавные"
            className={clsx(key, "max-w-[7rem]", shift && "border-accent text-accent")}
          >
            <ArrowBigUp className="h-6 w-6" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => add("-")} className={clsx(key, "max-w-[5rem]")}>
            -
          </button>
          <button type="button" onClick={() => add(" ")} className={clsx(key, "flex-[5] text-base text-muted")}>
            пробел
          </button>
          <button type="button" onClick={() => setText("")} className={clsx(key, "max-w-[8rem] !text-sm text-muted")}>
            Очистить
          </button>
          <button type="button" onClick={back} aria-label="Стереть" className={clsx(key, "max-w-[7rem]")}>
            <Delete className="h-6 w-6" strokeWidth={1.75} />
          </button>
        </div>
      </div>
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

// A text field for the till: looks like an input, opens the letter keyboard.
export function TextField({
  value,
  onChange,
  title,
  placeholder,
  maxLength,
  withDigits,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
  withDigits?: boolean;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "w-full truncate rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm transition hover:bg-surface-muted",
          className,
        )}
      >
        {value ? <span className="text-foreground">{value}</span> : <span className="text-muted">{placeholder ?? " "}</span>}
      </button>
      {open && (
        <TextKeypadModal
          title={title}
          initial={value}
          maxLength={maxLength}
          placeholder={placeholder}
          withDigits={withDigits}
          onClose={() => setOpen(false)}
          onDone={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
