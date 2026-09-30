import { FinanceCategoryKind } from "./finance";

// The three INDEPENDENT business classifications of a finance category.
// A category says what its money MEANS; it never says which balance-sheet
// line moves by how much — that is decided by the event rules, from the
// combination below. No combination is ever guessed: a category starts
// UNCLASSIFIED in all three, and stays visibly unclassified until someone sets it.

export enum PnlTreatment {
  UNCLASSIFIED = "UNCLASSIFIED",
  OPERATING_EXPENSE = "OPERATING_EXPENSE",
  OTHER_INCOME = "OTHER_INCOME",
  OTHER_EXPENSE = "OTHER_EXPENSE",
  FINANCIAL_INCOME = "FINANCIAL_INCOME",
  FINANCIAL_EXPENSE = "FINANCIAL_EXPENSE",
  INCOME_TAX = "INCOME_TAX",
  // Not a result: capital purchases, owner and loan flows.
  NOT_IN_PNL = "NOT_IN_PNL",
}

export enum CashActivity {
  UNCLASSIFIED = "UNCLASSIFIED",
  OPERATING = "OPERATING",
  INVESTING = "INVESTING",
  FINANCING = "FINANCING",
}

export enum BalanceTreatment {
  UNCLASSIFIED = "UNCLASSIFIED",
  NONE = "NONE",
  FIXED_ASSET = "FIXED_ASSET",
  OWNER_CONTRIBUTION = "OWNER_CONTRIBUTION",
  OWNER_WITHDRAWAL = "OWNER_WITHDRAWAL",
  LOAN_PROCEEDS = "LOAN_PROCEEDS",
  LOAN_REPAYMENT = "LOAN_REPAYMENT",
}

export const PNL_TREATMENT_LABELS_RU: Record<PnlTreatment, string> = {
  [PnlTreatment.UNCLASSIFIED]: "Не классифицировано",
  [PnlTreatment.OPERATING_EXPENSE]: "Операционные расходы",
  [PnlTreatment.OTHER_INCOME]: "Прочие доходы",
  [PnlTreatment.OTHER_EXPENSE]: "Прочие расходы",
  [PnlTreatment.FINANCIAL_INCOME]: "Финансовые доходы",
  [PnlTreatment.FINANCIAL_EXPENSE]: "Финансовые расходы",
  [PnlTreatment.INCOME_TAX]: "Налог на прибыль",
  [PnlTreatment.NOT_IN_PNL]: "Вне ОПиУ",
};

export const CASH_ACTIVITY_LABELS_RU: Record<CashActivity, string> = {
  [CashActivity.UNCLASSIFIED]: "Не классифицировано",
  [CashActivity.OPERATING]: "Операционная деятельность",
  [CashActivity.INVESTING]: "Инвестиционная деятельность",
  [CashActivity.FINANCING]: "Финансовая деятельность",
};

export const BALANCE_TREATMENT_LABELS_RU: Record<BalanceTreatment, string> = {
  [BalanceTreatment.UNCLASSIFIED]: "Не классифицировано",
  [BalanceTreatment.NONE]: "Без влияния на баланс",
  [BalanceTreatment.FIXED_ASSET]: "Основное средство",
  [BalanceTreatment.OWNER_CONTRIBUTION]: "Взнос собственника",
  [BalanceTreatment.OWNER_WITHDRAWAL]: "Изъятие собственника",
  [BalanceTreatment.LOAN_PROCEEDS]: "Получение займа",
  [BalanceTreatment.LOAN_REPAYMENT]: "Погашение займа",
};

export interface CategoryClassification {
  pnlTreatment: PnlTreatment;
  cashActivity: CashActivity;
  balanceTreatment: BalanceTreatment;
}

export const UNCLASSIFIED_CLASSIFICATION: CategoryClassification = {
  pnlTreatment: PnlTreatment.UNCLASSIFIED,
  cashActivity: CashActivity.UNCLASSIFIED,
  balanceTreatment: BalanceTreatment.UNCLASSIFIED,
};

export function isFullyClassified(c: CategoryClassification): boolean {
  return (
    c.pnlTreatment !== PnlTreatment.UNCLASSIFIED &&
    c.cashActivity !== CashActivity.UNCLASSIFIED &&
    c.balanceTreatment !== BalanceTreatment.UNCLASSIFIED
  );
}

export function isFullyUnclassified(c: CategoryClassification): boolean {
  return (
    c.pnlTreatment === PnlTreatment.UNCLASSIFIED &&
    c.cashActivity === CashActivity.UNCLASSIFIED &&
    c.balanceTreatment === BalanceTreatment.UNCLASSIFIED
  );
}

const EXPENSE_PNL: PnlTreatment[] = [
  PnlTreatment.OPERATING_EXPENSE,
  PnlTreatment.OTHER_EXPENSE,
  PnlTreatment.FINANCIAL_EXPENSE,
  PnlTreatment.INCOME_TAX,
  PnlTreatment.NOT_IN_PNL,
];
const INCOME_PNL: PnlTreatment[] = [PnlTreatment.OTHER_INCOME, PnlTreatment.FINANCIAL_INCOME, PnlTreatment.NOT_IN_PNL];

// Returns a Russian error message, or null when the combination is coherent.
// A triple is either entirely UNCLASSIFIED (the reset state) or entirely set.
export function validateClassification(kind: FinanceCategoryKind, c: CategoryClassification): string | null {
  if (isFullyUnclassified(c)) return null;
  if (!isFullyClassified(c)) return "Заполните все три признака классификации или сбросьте все три";

  const allowedPnl = kind === FinanceCategoryKind.EXPENSE ? EXPENSE_PNL : INCOME_PNL;
  if (!allowedPnl.includes(c.pnlTreatment)) {
    return kind === FinanceCategoryKind.EXPENSE
      ? "Для категории расходов этот вариант отражения в ОПиУ недоступен"
      : "Для категории доходов этот вариант отражения в ОПиУ недоступен";
  }

  if (c.pnlTreatment === PnlTreatment.NOT_IN_PNL) {
    const okBalance =
      kind === FinanceCategoryKind.EXPENSE
        ? [BalanceTreatment.FIXED_ASSET, BalanceTreatment.OWNER_WITHDRAWAL, BalanceTreatment.LOAN_REPAYMENT]
        : [BalanceTreatment.OWNER_CONTRIBUTION, BalanceTreatment.LOAN_PROCEEDS];
    if (!okBalance.includes(c.balanceTreatment)) return "Вне ОПиУ допустимы только капитальные, собственнические и заёмные операции";
    if (c.balanceTreatment === BalanceTreatment.FIXED_ASSET) {
      return c.cashActivity === CashActivity.INVESTING ? null : "Основное средство — это инвестиционная деятельность";
    }
    return c.cashActivity === CashActivity.FINANCING ? null : "Операции собственника и займы — это финансовая деятельность";
  }

  // A result line moves the balance only through the result itself.
  if (c.balanceTreatment !== BalanceTreatment.NONE) return "Для статьи результата влияние на баланс — «Без влияния на баланс»";
  if (c.pnlTreatment === PnlTreatment.FINANCIAL_EXPENSE || c.pnlTreatment === PnlTreatment.FINANCIAL_INCOME) {
    return c.cashActivity === CashActivity.OPERATING || c.cashActivity === CashActivity.FINANCING
      ? null
      : "Проценты относятся к операционной или финансовой деятельности";
  }
  if (c.cashActivity === CashActivity.FINANCING) return "Эта статья результата не может быть финансовой деятельностью";
  return null;
}

export interface SetFinanceCategoryClassificationRequestDto extends CategoryClassification {
  reason?: string;
}
