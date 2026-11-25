import {
  BalanceLine,
  BalanceTreatment,
  CASH_MOVEMENT_INFLOW_TYPES,
  CashMovementType,
  CashSection,
  FinancialEvent,
  FinancialEventType,
  PnlLine,
} from "@bakery-os/shared";
import { round2 } from "../../common/money";
import { CategoryLike, cashSectionOfCategory, isCategoryFullyClassified, pnlLineOfTreatment } from "./rules";

// The cash side of the event catalogue: one event per CashMovement (transfer
// pairs are one event). Each event carries its cash leg AND the counter-legs
// its type implies, so every classified event balances on its own (I1). A
// movement the rules cannot classify keeps only its cash leg and says so.

export interface CashMovementSource {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  occurredAt: Date;
  categoryId: string | null;
  expenseId: string | null;
  invoiceId: string | null;
  consignmentPaymentId: string | null;
  purchaseOrderPaymentId?: string | null;
  supplierReturnId?: string | null;
  fixedAssetId?: string | null;
  saleId: string | null;
  transferGroupId: string | null;
  // The movement sits on a participant's personal account: the business's own money did not move.
  personal?: boolean;
}

// The line of the cash-flow statement that stands for a participant's own money.
export const PARTNER_FUNDS_LABEL = "Средства участников (личные)";

export const signedCashAmount = (type: string, amount: number): number =>
  type === CashMovementType.ADJUSTMENT
    ? amount
    : CASH_MOVEMENT_INFLOW_TYPES.includes(type as CashMovementType)
      ? amount
      : -amount;

const base = (m: CashMovementSource) => ({
  key: `cash:${m.id}`,
  occurredAt: m.occurredAt.toISOString(),
  sourceType: "CashMovement",
  sourceId: m.id,
});

export function cashMovementEvent(m: CashMovementSource, category: CategoryLike | null): FinancialEvent {
  const event = { ...cashMovementEventCore(m, category), categoryName: category?.name ?? null };
  return m.personal ? viaPersonalAccount(event, m.accountId) : event;
}

// The same fact paid out of (or received into) a participant's own pocket. Everything the movement
// means stays as its type says — the supplier is paid, the expense is settled — but the business's
// money did not move: what changes instead is what the business owes the participant.
//   balance: «Денежные средства» ±X  →  «Задолженность перед участниками» ∓X
//   cash:    the payment stays in its own section of the cash-flow statement, and the participant's
//            money that covered it is shown beside it under financing. The two always net to zero,
//            so the statement's closing balance is the business's accounts and nothing else.
function viaPersonalAccount(event: FinancialEvent, accountId: string): FinancialEvent {
  const moved = round2(event.balance.filter((b) => b.line === BalanceLine.CASH_AND_BANK).reduce((s, b) => s + b.delta, 0));
  const balance = [
    ...event.balance.filter((b) => b.line !== BalanceLine.CASH_AND_BANK),
    { line: BalanceLine.PARTNER_PAYABLES, delta: round2(-moved) },
  ];
  // A declared starting position is not a flow of any kind.
  if (event.type === FinancialEventType.OPENING_BALANCE) return { ...event, cash: [], balance };
  const cash = [...event.cash, { accountId, section: CashSection.FINANCING, amount: round2(-moved), label: PARTNER_FUNDS_LABEL }];
  return { ...event, cash, balance };
}

function cashMovementEventCore(m: CashMovementSource, category: CategoryLike | null): FinancialEvent {
  const signed = round2(signedCashAmount(m.type, m.amount));
  const cashLeg = (section: CashSection) => [{ accountId: m.accountId, section, amount: signed }];
  const cashBalance = { line: BalanceLine.CASH_AND_BANK, delta: signed };

  switch (m.type) {
    case CashMovementType.OPENING_BALANCE:
      return {
        ...base(m),
        type: FinancialEventType.OPENING_BALANCE,
        description: "Начальный остаток счёта",
        cash: cashLeg(CashSection.OPENING),
        balance: [cashBalance, { line: BalanceLine.OPENING_EQUITY, delta: signed }],
        pnl: [],
        unclassified: false,
      };
    case CashMovementType.SALE_RECEIPT:
    case CashMovementType.CUSTOMER_PAYMENT:
      return {
        ...base(m),
        type: FinancialEventType.CUSTOMER_RECEIPT,
        description: "Поступление от покупателя",
        cash: cashLeg(CashSection.OPERATING),
        balance: [cashBalance, { line: BalanceLine.RECEIVABLES, delta: -signed }],
        pnl: [],
        unclassified: false,
      };
    case CashMovementType.SALE_REFUND:
      return {
        ...base(m),
        type: FinancialEventType.CUSTOMER_REFUND,
        description: "Возврат денег покупателю",
        cash: cashLeg(CashSection.OPERATING),
        // The refund settles what the return created: receivable goes back up.
        balance: [cashBalance, { line: BalanceLine.RECEIVABLES, delta: -signed }],
        pnl: [],
        unclassified: false,
      };
    case CashMovementType.SUPPLIER_PAYMENT:
      return {
        ...base(m),
        type: FinancialEventType.SUPPLIER_PAYMENT,
        description: "Оплата поставщику",
        cash: cashLeg(CashSection.OPERATING),
        balance: [
          cashBalance,
          { line: m.consignmentPaymentId ? BalanceLine.CONSIGNMENT_PAYABLES : BalanceLine.SUPPLIER_PAYABLES, delta: signed },
        ],
        pnl: [],
        unclassified: false,
      };
    case CashMovementType.OTHER_INCOME:
      // Money received for selling a fixed asset: investing cash, and the asset
      // is realised for that amount. The gain or loss against the book value is
      // the disposal event's own business (fixed-asset-events.ts).
      if (m.fixedAssetId) {
        return {
          ...base(m),
          type: FinancialEventType.ASSET_DISPOSAL,
          description: "Поступление от выбытия основного средства",
          cash: cashLeg(CashSection.INVESTING),
          balance: [cashBalance, { line: BalanceLine.FIXED_ASSETS, delta: -signed }],
          pnl: [],
          unclassified: false,
        };
      }
      return categoryDrivenEvent(m, category, signed);
    case CashMovementType.ADJUSTMENT:
      // The reversal of a purchase-order payment is not a free-form adjustment:
      // the money comes back and the payable it had settled is owed again.
      if (m.purchaseOrderPaymentId) {
        return {
          ...base(m),
          type: FinancialEventType.SUPPLIER_PAYMENT,
          description: "Отмена оплаты поставщику",
          cash: cashLeg(CashSection.OPERATING),
          balance: [cashBalance, { line: BalanceLine.SUPPLIER_PAYABLES, delta: signed }],
          pnl: [],
          unclassified: false,
        };
      }
      // Money a supplier handed back for goods returned to them: the order had
      // been paid for more than it is now worth, and this settles it.
      if (m.supplierReturnId) {
        return {
          ...base(m),
          type: FinancialEventType.SUPPLIER_PAYMENT,
          description: "Возврат денег от поставщика",
          cash: cashLeg(CashSection.OPERATING),
          balance: [cashBalance, { line: BalanceLine.SUPPLIER_PAYABLES, delta: signed }],
          pnl: [],
          unclassified: false,
        };
      }
      return categoryDrivenEvent(m, category, signed);
    case CashMovementType.EXPENSE_PAYMENT:
      return {
        ...base(m),
        type: FinancialEventType.EXPENSE_PAYMENT,
        description: "Оплата расхода",
        // Where it appears in the cash-flow statement depends on the expense's
        // category; the counter-side (the payable it settles) does not.
        cash: cashLeg(cashSectionOfCategory(category)),
        balance: [cashBalance, { line: BalanceLine.EXPENSE_PAYABLES, delta: signed }],
        pnl: [],
        // Complete: the payable it settles is known whatever the section. Only
        // its place in the cash-flow statement is undecided (UNCLASSIFIED section).
        unclassified: false,
      };
    default:
      return categoryDrivenEvent(m, category, signed);
  }
}

// Deposits, withdrawals, other income/expense and adjustments mean whatever
// their category says. Without a usable category nothing is guessed.
function categoryDrivenEvent(m: CashMovementSource, category: CategoryLike | null, signed: number): FinancialEvent {
  const cashBalance = { line: BalanceLine.CASH_AND_BANK, delta: signed };
  if (!isCategoryFullyClassified(category)) {
    return {
      ...base(m),
      type: FinancialEventType.CASH_UNCLASSIFIED,
      description: "Движение денег без классификации",
      cash: [{ accountId: m.accountId, section: cashSectionOfCategory(category), amount: signed }],
      balance: [cashBalance],
      pnl: [],
      unclassified: true,
    };
  }
  const section = cashSectionOfCategory(category);
  const cash = [{ accountId: m.accountId, section, amount: signed }];
  const event = (type: FinancialEventType, description: string, counter: FinancialEvent["balance"], pnl: FinancialEvent["pnl"] = []): FinancialEvent => ({
    ...base(m),
    type,
    description,
    cash,
    balance: [cashBalance, ...counter],
    pnl,
    unclassified: false,
  });

  switch (category.balanceTreatment) {
    case BalanceTreatment.OWNER_CONTRIBUTION:
      return event(FinancialEventType.OWNER_CONTRIBUTION, "Взнос собственника", [{ line: BalanceLine.OWNER_CONTRIBUTIONS, delta: signed }]);
    case BalanceTreatment.OWNER_WITHDRAWAL:
      return event(FinancialEventType.OWNER_WITHDRAWAL, "Изъятие собственника", [{ line: BalanceLine.OWNER_WITHDRAWALS, delta: signed }]);
    case BalanceTreatment.LOAN_PROCEEDS:
      return event(FinancialEventType.LOAN_PROCEEDS, "Получение займа", [{ line: BalanceLine.LOANS, delta: signed }]);
    case BalanceTreatment.LOAN_REPAYMENT:
      return event(FinancialEventType.LOAN_REPAYMENT, "Погашение займа", [{ line: BalanceLine.LOANS, delta: signed }]);
    case BalanceTreatment.FIXED_ASSET:
      return event(FinancialEventType.CASH_RESULT, "Покупка основного средства", [{ line: BalanceLine.FIXED_ASSETS, delta: -signed }]);
    default: {
      const line = pnlLineOfTreatment(category.pnlTreatment);
      // FULLY classified but neither a result nor a balance line cannot happen
      // through validation; if it does, treat it as unclassified, not as a result.
      if (!line) {
        return { ...event(FinancialEventType.CASH_UNCLASSIFIED, "Движение денег без классификации", []), unclassified: true };
      }
      return event(FinancialEventType.CASH_RESULT, "Результат денежной операции", [], [{ line: line as PnlLine, amount: signed }]);
    }
  }
}

// Both legs of a transfer between own accounts: money leaves one and arrives
// at the other, so the event nets to exactly zero and reaches no statement line.
export function transferEvent(legs: CashMovementSource[], key: string): FinancialEvent {
  const first = legs.reduce((a, b) => (a.occurredAt <= b.occurredAt ? a : b));
  if (legs.some((l) => l.personal)) return partnerTransferEvent(legs, key, first);
  const cash = legs.map((l) => ({
    accountId: l.accountId,
    section: CashSection.INTERNAL,
    amount: round2(signedCashAmount(l.type, l.amount)),
  }));
  const net = round2(cash.reduce((s, c) => s + c.amount, 0));
  return {
    key,
    type: FinancialEventType.INTERNAL_TRANSFER,
    occurredAt: first.occurredAt.toISOString(),
    sourceType: "CashTransfer",
    sourceId: key.replace(/^transfer:/, ""),
    description: "Перевод между своими счетами",
    cash,
    balance: cash.map((c) => ({ line: BalanceLine.CASH_AND_BANK, delta: c.amount })),
    pnl: [],
    // A one-legged "transfer" (its pair is missing) is not a neutral event: it
    // moves cash with no counterpart, and is reported as unclassified.
    unclassified: legs.length !== 2 || net !== 0,
  };
}

// A transfer with a participant's personal account on one side is not a move between the business's
// own accounts: it pays the participant back (or takes money from them), so it is a financing flow of
// the business's account and a change of what is owed. Between two personal accounts only the debt
// moves from one participant to the other.
function partnerTransferEvent(legs: CashMovementSource[], key: string, first: CashMovementSource): FinancialEvent {
  const own = legs.filter((l) => !l.personal);
  const personal = legs.filter((l) => l.personal);
  const signedOf = (l: CashMovementSource) => round2(signedCashAmount(l.type, l.amount));
  const ownNet = round2(own.reduce((s, l) => s + signedOf(l), 0));
  const personalNet = round2(personal.reduce((s, l) => s + signedOf(l), 0));
  const paired = legs.length === 2 && round2(ownNet + personalNet) === 0;
  return {
    key,
    type: FinancialEventType.PARTNER_SETTLEMENT,
    occurredAt: first.occurredAt.toISOString(),
    sourceType: "CashTransfer",
    sourceId: key.replace(/^transfer:/, ""),
    description: own.length === 0 ? "Перевод между личными счетами участников" : ownNet < 0 ? "Возврат средств участнику" : "Поступление средств от участника",
    cash: own.map((l) => ({ accountId: l.accountId, section: CashSection.FINANCING, amount: signedOf(l) })),
    balance: [
      ...own.map((l) => ({ line: BalanceLine.CASH_AND_BANK, delta: signedOf(l) })),
      // Money arriving on the personal account lowers what the business owes its holder.
      ...personal.map((l) => ({ line: BalanceLine.PARTNER_PAYABLES, delta: round2(-signedOf(l)) })),
    ],
    pnl: [],
    unclassified: !paired,
  };
}
