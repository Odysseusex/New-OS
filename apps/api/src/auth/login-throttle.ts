import { HttpException, HttpStatus } from "@nestjs/common";

// Password guessing on the sign-in page. Wrong passwords are counted in memory (the API is one
// process): per email + address 10 in 15 minutes, and per email alone 100 in an hour — the second
// catches guessing from many addresses. A right password does not wipe the count.
const WINDOW_MS = 15 * 60_000;
const LIMIT = 10;
const EMAIL_WINDOW_MS = 60 * 60_000;
const EMAIL_LIMIT = 100;
const MAX_KEYS = 20_000;

const failures = new Map<string, number[]>();

function recent(key: string, windowMs: number): number[] {
  const now = Date.now();
  const list = (failures.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

const keys = (email: string, ip: string) => ({ pair: `p:${email.trim().toLowerCase()}|${ip}`, email: `e:${email.trim().toLowerCase()}` });

export function assertLoginAllowed(email: string, ip: string): void {
  const k = keys(email, ip);
  if (recent(k.pair, WINDOW_MS).length >= LIMIT || recent(k.email, EMAIL_WINDOW_MS).length >= EMAIL_LIMIT) {
    throw new HttpException("Слишком много попыток входа — подождите 15 минут", HttpStatus.TOO_MANY_REQUESTS);
  }
}

export function noteLoginFailure(email: string, ip: string): void {
  if (failures.size > MAX_KEYS) failures.clear();
  const k = keys(email, ip);
  const now = Date.now();
  failures.set(k.pair, [...recent(k.pair, WINDOW_MS), now]);
  failures.set(k.email, [...recent(k.email, EMAIL_WINDOW_MS), now]);
}

// For specs.
export function resetLoginThrottle(): void {
  failures.clear();
}
