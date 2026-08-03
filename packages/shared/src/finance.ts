export enum ExpenseCategory {
  RENT = "RENT",
  UTILITIES = "UTILITIES",
  SALARY = "SALARY",
  MARKETING = "MARKETING",
  LOGISTICS = "LOGISTICS",
  OTHER = "OTHER",
}

export const EXPENSE_CATEGORY_LABELS_RU: Record<ExpenseCategory, string> = {
  [ExpenseCategory.RENT]: "Аренда",
  [ExpenseCategory.UTILITIES]: "Коммунальные услуги",
  [ExpenseCategory.SALARY]: "Зарплата",
  [ExpenseCategory.MARKETING]: "Маркетинг",
  [ExpenseCategory.LOGISTICS]: "Логистика",
  [ExpenseCategory.OTHER]: "Прочее",
};

export interface ExpenseDto {
  id: string;
  locationId: string | null;
  locationName: string | null;
  category: ExpenseCategory;
  amount: number;
  description: string | null;
  incurredOn: string;
  createdByName: string;
}

export interface CreateExpenseRequestDto {
  locationId?: string;
  category: ExpenseCategory;
  amount: number;
  description?: string;
  incurredOn?: string;
}

export type FinancePeriodPreset = "today" | "7d" | "30d" | "month";

export interface ProductPnLDto {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPercent: number | null;
  hasCostData: boolean;
}

export interface ProfitAndLossDto {
  from: string;
  to: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  expensesTotal: number;
  netProfit: number;
  unknownCostLineItems: number;
  byProduct: ProductPnLDto[];
}
