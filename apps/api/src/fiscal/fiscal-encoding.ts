// Encoders for the KGD fiscal protocol (re:Kassa API 2.0.3).
//
// Two conventions here are easy to get catastrophically wrong, which is why
// they live in one small tested file rather than inline at the call site:
//
//   Money    — split into whole tenge and tiyn: 650.50 ₸ -> { bills: "650", coins: 50 }
//   Quantity — thousandths: 3 items -> 3000, 2.5 kg -> 2500
//
// Mixing those up misreports a sale by a factor of a thousand on a legally
// binding document.

export interface FiscalMoney {
  // String, matching the protocol's own examples — the whole-tenge part can
  // exceed what a 32-bit integer field would safely carry.
  bills: string;
  coins: number;
}

// Rounds to the nearest tiyn before splitting: floating point subtraction
// would otherwise turn 650.50 into coins 49 via 0.49999999999997.
export function toFiscalMoney(amount: number): FiscalMoney {
  if (!Number.isFinite(amount)) {
    throw new Error(`Cannot encode a non-finite amount: ${amount}`);
  }
  if (amount < 0) {
    throw new Error(`Cannot encode a negative amount: ${amount}`);
  }
  const totalCoins = Math.round(amount * 100);
  return {
    bills: String(Math.floor(totalCoins / 100)),
    coins: totalCoins % 100,
  };
}

// Quantity in thousandths, per the protocol ("1000 == 1,0, 2500 == 2,5").
export function toFiscalQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    throw new Error(`Cannot encode a non-finite quantity: ${quantity}`);
  }
  if (quantity <= 0) {
    throw new Error(`Cannot encode a non-positive quantity: ${quantity}`);
  }
  return Math.round(quantity * 1000);
}

// Percentages are also in thousandths of a percent ("12000 == 12,0%").
export function toFiscalPercent(percent: number): number {
  return Math.round(percent * 1000);
}

export interface FiscalDateTime {
  date: { year: number; month: number; day: number };
  time: { hour: number; minute: number; second: number };
}

// The receipt must carry the wall-clock time at the till, not the server's
// UTC — a receipt stamped in the wrong day is a reporting problem for a
// legally filed document. Formatted via Intl so the zone's real offset is
// applied rather than a hardcoded +5.
export function toFiscalDateTime(date: Date, timeZone: string): FiscalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`Missing ${type} while formatting a fiscal timestamp`);
    // "24" is what some ICU versions emit for midnight in hour12:false.
    return Number(value) % (type === "hour" ? 24 : Number.MAX_SAFE_INTEGER);
  };

  return {
    date: { year: get("year"), month: get("month"), day: get("day") },
    time: { hour: get("hour"), minute: get("minute"), second: get("second") },
  };
}
