import {
  BalanceLine,
  BalanceTreatment,
  CashActivity,
  CashSection,
  PnlLine,
  PnlTreatment,
} from "@bakery-os/shared";

// The ONE place a category's classification is turned into statement effects.
// The P&L, the cash-flow statement and the balance sheet all read these rules,
// so a category can never mean one thing in one report and another elsewhere.

export interface CategoryLike {
  name?: string;
  pnlTreatment: string;
  cashActivity: string;
  balanceTreatment: string;
}

export const isCategoryFullyClassified = (c: CategoryLike | null | undefined): c is CategoryLike =>
  !!c &&
  c.pnlTreatment !== PnlTreatment.UNCLASSIFIED &&
  c.cashActivity !== CashActivity.UNCLASSIFIED &&
  c.balanceTreatment !== BalanceTreatment.UNCLASSIFIED;

// Which cash-flow section a movement of this category belongs to. Only the
// cash dimension is needed: it decides the section on its own, so a category
// classified for cash but not yet for P&L still shows up in the right place.
export function cashSectionOfCategory(c: CategoryLike | null | undefined): CashSection {
  switch (c?.cashActivity) {
    case CashActivity.OPERATING:
      return CashSection.OPERATING;
    case CashActivity.INVESTING:
      return CashSection.INVESTING;
    case CashActivity.FINANCING:
      return CashSection.FINANCING;
    default:
      return CashSection.UNCLASSIFIED;
  }
}

export function pnlLineOfTreatment(t: string): PnlLine | null {
  switch (t) {
    case PnlTreatment.OPERATING_EXPENSE:
      return PnlLine.OPERATING_EXPENSE;
    case PnlTreatment.OTHER_INCOME:
      return PnlLine.OTHER_INCOME;
    case PnlTreatment.OTHER_EXPENSE:
      return PnlLine.OTHER_EXPENSE;
    case PnlTreatment.FINANCIAL_INCOME:
      return PnlLine.FINANCIAL_INCOME;
    case PnlTreatment.FINANCIAL_EXPENSE:
      return PnlLine.FINANCIAL_EXPENSE;
    case PnlTreatment.INCOME_TAX:
      return PnlLine.INCOME_TAX;
    default:
      return null;
  }
}

// What a confirmed expense DOCUMENT does when it is incurred (before any
// payment): the P&L line it hits, or the balance line it capitalises into.
export interface ExpenseAccrualEffect {
  pnlLine: PnlLine | null;
  // A capital purchase / owner / loan expense reaches the balance sheet, not the P&L.
  balanceLine: BalanceLine | null;
  // The category gave no usable classification. The expense still counts as an
  // operating expense (what the system has always done), flagged so it is visible.
  unclassified: boolean;
}

export function expenseAccrualEffect(c: CategoryLike | null | undefined): ExpenseAccrualEffect {
  if (!c || c.pnlTreatment === PnlTreatment.UNCLASSIFIED) {
    return { pnlLine: PnlLine.OPERATING_EXPENSE, balanceLine: null, unclassified: true };
  }
  if (c.pnlTreatment === PnlTreatment.NOT_IN_PNL) {
    switch (c.balanceTreatment) {
      case BalanceTreatment.FIXED_ASSET:
        return { pnlLine: null, balanceLine: BalanceLine.FIXED_ASSETS, unclassified: false };
      case BalanceTreatment.OWNER_WITHDRAWAL:
        return { pnlLine: null, balanceLine: BalanceLine.OWNER_WITHDRAWALS, unclassified: false };
      case BalanceTreatment.LOAN_REPAYMENT:
        return { pnlLine: null, balanceLine: BalanceLine.LOANS, unclassified: false };
      default:
        // NOT_IN_PNL with no balance meaning cannot be placed anywhere.
        return { pnlLine: PnlLine.OPERATING_EXPENSE, balanceLine: null, unclassified: true };
    }
  }
  return { pnlLine: pnlLineOfTreatment(c.pnlTreatment), balanceLine: null, unclassified: false };
}
