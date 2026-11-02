"use client";

import { normalizeBin, PAYMENT_TERM_MAX_DAYS } from "@bakery-os/shared";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export interface CounterpartyTermsValue {
  bin: string;
  paymentTermDays: string;
}

export const termsValueOf = (c?: { bin: string | null; paymentTermDays: number | null } | null): CounterpartyTermsValue => ({
  bin: c?.bin ?? "",
  paymentTermDays: c?.paymentTermDays !== null && c?.paymentTermDays !== undefined ? String(c.paymentTermDays) : "",
});

// What the API gets: an emptied field clears the stored value (null) on an
// edit, and is simply left out on a new record. Throws the message to show.
export function termsPayload(value: CounterpartyTermsValue, editing: boolean): { bin?: string | null; paymentTermDays?: number | null } {
  const binText = value.bin.trim();
  if (binText !== "" && normalizeBin(binText) === null) throw new Error("БИН/ИИН — 12 цифр");
  const termText = value.paymentTermDays.trim();
  const term = termText === "" ? null : Number(termText);
  if (term !== null && (!Number.isInteger(term) || term < 0 || term > PAYMENT_TERM_MAX_DAYS)) {
    throw new Error(`Отсрочка оплаты — целое число дней от 0 до ${PAYMENT_TERM_MAX_DAYS}`);
  }
  return {
    ...(binText !== "" ? { bin: normalizeBin(binText) } : editing ? { bin: null } : {}),
    ...(term !== null ? { paymentTermDays: term } : editing ? { paymentTermDays: null } : {}),
  };
}

export function CounterpartyTermsFields({ value, onChange }: { value: CounterpartyTermsValue; onChange: (v: CounterpartyTermsValue) => void }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          БИН / ИИН <span className="text-muted">(необязательно)</span>
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={15}
          value={value.bin}
          onChange={(e) => onChange({ ...value, bin: e.target.value })}
          placeholder="12 цифр"
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Отсрочка оплаты, дней <span className="text-muted">(необязательно)</span>
        </label>
        <input
          type="number"
          min="0"
          max={PAYMENT_TERM_MAX_DAYS}
          step="1"
          value={value.paymentTermDays}
          onChange={(e) => onChange({ ...value, paymentTermDays: e.target.value })}
          className={inputClass}
        />
      </div>
    </div>
  );
}
