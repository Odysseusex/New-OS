"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { isValidBirthDate, MONTHS_GENITIVE_RU } from "@bakery-os/shared";
import { Modal } from "@/components/modal";
import { NumericKeypad, usePhysicalKeys } from "@/components/numeric-keypad";

// A birthday typed on the till's digit pad as ДД.ММ(.ГГГГ) — the month can also be tapped by name,
// and the date is always read back in words («15 июля 1990»), so «05» and «июль» cannot be mixed up.

const SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export interface BirthDateValue {
  day: string;
  month: string;
  year: string;
}

export function birthDateWords(day: number, month: number, year: number | null) {
  return `${day} ${MONTHS_GENITIVE_RU[month - 1]}${year ? ` ${year}` : ""}`;
}

function parse(digits: string) {
  const day = digits.length >= 2 ? Number(digits.slice(0, 2)) : null;
  const month = digits.length >= 4 ? Number(digits.slice(2, 4)) : null;
  const year = digits.length === 8 ? Number(digits.slice(4, 8)) : null;
  return { day, month, year };
}

export function BirthDatePadModal({
  initial,
  onDone,
  onClose,
}: {
  initial: BirthDateValue;
  onDone: (value: BirthDateValue) => void;
  onClose: () => void;
}) {
  const start = initial.day && initial.month ? `${initial.day.padStart(2, "0")}${initial.month.padStart(2, "0")}${initial.year}` : "";
  const [digits, setDigits] = useState(start);
  const { day, month, year } = parse(digits);
  const yearOk = digits.length === 4 || digits.length === 8;
  const valid = day !== null && month !== null && yearOk && isValidBirthDate(month, day, year) && (year === null || (year >= 1900 && year <= new Date().getFullYear()));
  const wrong = (month !== null && !isValidBirthDate(month, day ?? 1, null)) || (digits.length === 8 && !valid);

  const add = (d: string) => setDigits((t) => (t.length >= 8 ? t : t + d));
  const back = () => setDigits((t) => t.slice(0, -1));
  const done = () => {
    if (!valid) return;
    onDone({ day: String(day), month: String(month), year: year ? String(year) : "" });
  };
  const scope = useRef<HTMLDivElement>(null);
  usePhysicalKeys(add, back, done, scope);

  const slot = (from: number, len: number) =>
    Array.from({ length: len }, (_, i) => digits[from + i] ?? "_").join("");

  return (
    <Modal title="Дата рождения" onClose={onClose} width="max-w-md">
      <div ref={scope} className={clsx("rounded-2xl border bg-surface-muted px-4 py-3 text-center", wrong ? "border-red-300" : "border-border")}>
        <div className="text-[1.75rem] font-semibold tabular-nums tracking-wide text-foreground">
          {slot(0, 2)}.{slot(2, 2)}.{slot(4, 4)}
        </div>
        <div className={clsx("mt-0.5 h-5 text-sm", wrong ? "text-red-600" : "text-muted")}>
          {wrong
            ? "Такой даты нет"
            : day !== null && month !== null
              ? birthDateWords(day, month, year)
              : "день, месяц, год (год можно не вводить)"}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-6 gap-1.5">
        {SHORT.map((m, i) => {
          const mm = String(i + 1).padStart(2, "0");
          return (
            <button
              key={m}
              type="button"
              disabled={digits.length < 2}
              onClick={() => setDigits((t) => t.slice(0, 2) + mm)}
              className={clsx(
                "rounded-lg border px-1 py-1.5 text-center text-sm leading-tight transition disabled:opacity-40",
                month === i + 1 ? "border-accent bg-accent/10 text-accent" : "border-border text-foreground hover:bg-surface-muted",
              )}
            >
              <span className="block text-xs text-muted">{mm}</span>
              {m}
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <NumericKeypad onDigit={add} onBackspace={back} onClear={() => setDigits("")} />
      </div>
      <button
        type="button"
        data-submit
        onClick={done}
        disabled={!valid}
        className="mt-4 h-14 w-full rounded-2xl bg-accent text-lg font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        Готово
      </button>
    </Modal>
  );
}

// Looks like an input on the till; opens the pad.
export function BirthDateField({ value, onChange }: { value: BirthDateValue; onChange: (value: BirthDateValue) => void }) {
  const [open, setOpen] = useState(false);
  const set = value.day && value.month;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm tabular-nums transition hover:bg-surface"
      >
        {set ? (
          <span className="text-foreground">
            {value.day.padStart(2, "0")}.{value.month.padStart(2, "0")}
            {value.year ? `.${value.year}` : ""} · {birthDateWords(Number(value.day), Number(value.month), value.year ? Number(value.year) : null)}
          </span>
        ) : (
          <span className="text-muted">ДД.ММ.ГГГГ</span>
        )}
      </button>
      {open && (
        <BirthDatePadModal
          initial={value}
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
