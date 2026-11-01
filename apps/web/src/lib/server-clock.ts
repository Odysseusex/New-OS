// "Now" as the server sees it. Every report boundary («Сегодня», «Этот месяц»…) is
// computed in the browser, but the rows it is compared with are stamped by the
// server — so a device whose own clock is wrong (a monoblock showing tomorrow's
// date) asked for a "today" that had not begun yet and got nothing back. Every
// API response carries the server's `Date` header; when the device is more than
// a couple of minutes off, the difference is applied here. A device with a
// correct clock is left exactly on its own time (the header is whole seconds,
// plus network delay — noise not worth applying).
const IGNORE_SKEW_MS = 2 * 60_000;

let skewMs = 0;

export function noteServerDate(header: string | null): void {
  if (!header) return;
  const server = Date.parse(header);
  if (Number.isNaN(server)) return;
  const skew = server - Date.now();
  skewMs = Math.abs(skew) > IGNORE_SKEW_MS ? skew : 0;
}

export function serverNow(): Date {
  return new Date(Date.now() + skewMs);
}
