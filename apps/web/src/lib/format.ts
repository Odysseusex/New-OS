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
