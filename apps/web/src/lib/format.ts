const currencyFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KZT",
  maximumFractionDigits: 0,
});

export function formatMoney(value: number): string {
  return currencyFormatter.format(value);
}

// Same currency, but with 2 decimal places — for per-unit costs that are
// often fractional tenge (e.g. 190.43), where rounding to whole tenge would
// hide the actual number behind the margin calculation.
const preciseCurrencyFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KZT",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoneyPrecise(value: number): string {
  return preciseCurrencyFormatter.format(value);
}

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
}

// Formats a Date/ISO string for a <input type="datetime-local"> value, in
// the browser's local time (not UTC) — the format that input requires.
export function toDatetimeLocalValue(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
