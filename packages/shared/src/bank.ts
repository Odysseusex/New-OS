// Bank statements (загрузка выписки): parsed in the browser from the bank's
// file, stored line by line, and posted into the ordinary ledgers.

export enum BankLineAction {
  SALES_SETTLEMENT = "SALES_SETTLEMENT",
  CATEGORY = "CATEGORY",
  TRANSFER = "TRANSFER",
  SUPPLIER_PAYMENT = "SUPPLIER_PAYMENT",
  IGNORE = "IGNORE",
  CUSTOMER_PAYMENT = "CUSTOMER_PAYMENT",
}

export const BANK_LINE_ACTION_LABELS_RU: Record<BankLineAction, string> = {
  [BankLineAction.SALES_SETTLEMENT]: "Выручка с кассы (уже учтена)",
  [BankLineAction.CATEGORY]: "По статье",
  [BankLineAction.TRANSFER]: "Перевод между своими счетами",
  [BankLineAction.SUPPLIER_PAYMENT]: "Оплата поставщику",
  [BankLineAction.IGNORE]: "Не проводить (уже учтено)",
  [BankLineAction.CUSTOMER_PAYMENT]: "Оплата от покупателя",
};

export enum BankLineStatus {
  NEW = "NEW",
  POSTED = "POSTED",
  IGNORED = "IGNORED",
}

export const BANK_LINE_STATUS_LABELS_RU: Record<BankLineStatus, string> = {
  [BankLineStatus.NEW]: "Не проведено",
  [BankLineStatus.POSTED]: "Проведено",
  [BankLineStatus.IGNORED]: "Пропущено",
};

// Categories the import offers by name and creates (classified) on first use.
export enum BankPresetCategory {
  BANK_FEE = "BANK_FEE",
  OWNER_WITHDRAWAL = "OWNER_WITHDRAWAL",
}

export const BANK_PRESET_CATEGORY_NAMES_RU: Record<BankPresetCategory, string> = {
  [BankPresetCategory.BANK_FEE]: "Комиссия банка",
  [BankPresetCategory.OWNER_WITHDRAWAL]: "Изъятие собственника",
};

export interface ParsedBankLineDto {
  docNumber: string;
  occurredAt: string; // ISO
  amount: number; // + in, − out
  counterpartyName: string | null;
  counterpartyBin: string | null;
  counterpartyIban: string | null;
  knp: string | null;
  purpose: string | null;
}

export interface UploadBankStatementRequestDto {
  accountId: string;
  bankName: string;
  iban: string | null;
  holderBin: string | null;
  periodFrom: string;
  periodTo: string;
  openingBalance: number | null;
  closingBalance: number | null;
  fileName: string | null;
  lines: ParsedBankLineDto[];
}

export interface BankLineSuggestionDto {
  action: BankLineAction;
  categoryId: string | null;
  presetCategory: BankPresetCategory | null;
  targetAccountId: string | null;
  supplierId: string | null;
  customerId: string | null;
  // Where the suggestion came from: a remembered rule, a keyword in the purpose, the bank's own wording, a known ИИН/БИН.
  source: "RULE" | "KEYWORD" | "BUILT_IN" | "COUNTERPARTY" | null;
}

export interface BankStatementLineDto extends ParsedBankLineDto {
  id: string;
  status: BankLineStatus;
  action: BankLineAction | null;
  categoryId: string | null;
  categoryName: string | null;
  targetAccountId: string | null;
  supplierId: string | null;
  customerId: string | null;
  resultNote: string | null;
  suggestion: BankLineSuggestionDto | null;
  // For a sales settlement: the Almaty day it pays out.
  settlementDate: string | null;
}

export interface SettlementDayDto {
  date: string; // YYYY-MM-DD
  bankAmount: number;
  // Card/Kaspi takings the till recorded into this account that day (receipts − refunds).
  systemAmount: number;
  difference: number;
}

export interface BankStatementDto {
  id: string;
  accountId: string;
  accountName: string;
  bankName: string;
  iban: string | null;
  periodFrom: string;
  periodTo: string;
  openingBalance: number | null;
  closingBalance: number | null;
  fileName: string | null;
  createdAt: string;
  createdByName: string;
  lines: BankStatementLineDto[];
  // Lines of the file already loaded before (same document number on this account).
  duplicatesSkipped: number;
  settlement: SettlementDayDto[];
  // This account's balance in the system at the statement's end, vs the bank's.
  systemClosingBalance: number;
}

export interface BankStatementSummaryDto {
  id: string;
  accountName: string;
  bankName: string;
  periodFrom: string;
  periodTo: string;
  lineCount: number;
  newCount: number;
  createdAt: string;
}

export interface PostBankLineRequestDto {
  lineId: string;
  action: BankLineAction;
  categoryId?: string | null;
  presetCategory?: BankPresetCategory | null;
  targetAccountId?: string | null;
  supplierId?: string | null;
  customerId?: string | null;
  remember?: boolean;
}

export interface PostBankLinesRequestDto {
  lines: PostBankLineRequestDto[];
}

export interface PostBankLinesResultDto {
  posted: number;
  failed: { lineId: string; message: string }[];
  statement: BankStatementDto;
}

// «Ключевые слова» (ТЗ §6.2): a word in the payment purpose → a ДДС article.
export interface BankKeywordRuleDto {
  id: string;
  keyword: string;
  // +1 money in, −1 money out.
  direction: 1 | -1;
  categoryId: string;
  categoryName: string;
}

export interface CreateBankKeywordRuleRequestDto {
  keyword: string;
  direction: 1 | -1;
  categoryId: string;
}

// The case-insensitive match of a keyword against a payment purpose: «ЗП» finds «Выплата ЗП за октябрь».
export function purposeHasKeyword(purpose: string | null | undefined, keyword: string): boolean {
  const k = keyword.trim().toLowerCase().replace(/ё/g, "е");
  if (!k || !purpose) return false;
  return purpose.toLowerCase().replace(/ё/g, "е").includes(k);
}
