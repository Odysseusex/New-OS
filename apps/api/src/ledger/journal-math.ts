import { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";

// Every ledger sum is exact decimal arithmetic. A JavaScript number never takes
// part in adding or comparing amounts: 0.1 + 0.2 is not 0.3 there, and an entry
// that "almost" balances is not an entry that balances.

export type Dec = Prisma.Decimal;
export const ZERO: Dec = new Prisma.Decimal(0);

export class LedgerRejectedError extends BadRequestException {
  constructor(
    public readonly code: LedgerRejectionCode,
    message: string,
  ) {
    super(message);
  }
}

export type LedgerRejectionCode =
  | "DOES_NOT_BALANCE"
  | "TOO_FEW_LINES"
  | "BAD_LINE"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_INACTIVE"
  | "PERIOD_CLOSED"
  | "BEFORE_LEDGER_START"
  | "LEDGER_DISABLED"
  | "ALREADY_REVERSED"
  | "NOT_REVERSIBLE";

// From a number the caller typed or an API sent: more than two decimals is an
// error, never a silent rounding.
export function exactAmount(value: number | string | Dec | null | undefined, what = "Сумма"): Dec {
  if (value === null || value === undefined || value === "") return ZERO;
  let d: Dec;
  try {
    d = new Prisma.Decimal(typeof value === "number" ? String(value) : (value as string | Dec));
  } catch {
    throw new LedgerRejectedError("BAD_LINE", `${what}: не число`);
  }
  if (!d.isFinite()) throw new LedgerRejectedError("BAD_LINE", `${what}: не число`);
  if (d.decimalPlaces() > 2) {
    throw new LedgerRejectedError("BAD_LINE", `${what}: не более двух знаков после запятой (${d.toString()})`);
  }
  return d;
}

// From an amount the event rules computed (already rounded to tiyn, but a
// float such as 100.10000000000001 may carry noise): snap to two decimals.
export function fromComputed(value: number): Dec {
  return new Prisma.Decimal(value.toFixed(2));
}

export const sum = (values: Dec[]): Dec => values.reduce((a, b) => a.plus(b), ZERO);

export interface AmountLine {
  debit: Dec;
  credit: Dec;
}

// The shape rules every posted line must satisfy, checked before anything is
// written (the database repeats them as constraints, for any client that
// bypasses this code).
export function validateLines(lines: AmountLine[]): { totalDebit: Dec; totalCredit: Dec } {
  if (lines.length < 2) {
    throw new LedgerRejectedError("TOO_FEW_LINES", "Проводка должна содержать не менее двух строк");
  }
  lines.forEach((l, i) => {
    const n = i + 1;
    if (l.debit.isNegative() || l.credit.isNegative()) {
      throw new LedgerRejectedError("BAD_LINE", `Строка ${n}: отрицательная сумма недопустима`);
    }
    if (l.debit.gt(0) && l.credit.gt(0)) {
      throw new LedgerRejectedError("BAD_LINE", `Строка ${n}: сумма не может быть одновременно в дебете и в кредите`);
    }
    if (l.debit.isZero() && l.credit.isZero()) {
      throw new LedgerRejectedError("BAD_LINE", `Строка ${n}: нулевая строка недопустима`);
    }
  });
  const totalDebit = sum(lines.map((l) => l.debit));
  const totalCredit = sum(lines.map((l) => l.credit));
  if (!totalDebit.equals(totalCredit)) {
    throw new LedgerRejectedError(
      "DOES_NOT_BALANCE",
      `Проводка не сбалансирована: дебет ${totalDebit.toFixed(2)} ≠ кредит ${totalCredit.toFixed(2)}`,
    );
  }
  return { totalDebit, totalCredit };
}

// Signed balance on the account's own normal side.
export function onNormalSide(normal: "DEBIT" | "CREDIT", debit: Dec, credit: Dec): Dec {
  return normal === "DEBIT" ? debit.minus(credit) : credit.minus(debit);
}

export const num = (d: Dec): number => d.toNumber();
