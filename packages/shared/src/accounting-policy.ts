// Accounting policy — what the business has APPROVED, kept apart from what the
// system currently DOES. A setting with no approved value reports either the
// current behaviour (when the system already does something) or
// NOT_CONFIGURED (when nothing depends on it yet). It is never presented as
// an approved policy unless someone with POLICY_MANAGE_ROLES approved it.

export enum NegativeStockPolicy {
  BLOCK = "BLOCK",
}

export enum WriteOffPresentation {
  SEPARATE_LINE = "SEPARATE_LINE",
  IN_COGS = "IN_COGS",
}

export enum ReturnScrapPresentation {
  KEEP_IN_COGS = "KEEP_IN_COGS",
  INVENTORY_LOSS = "INVENTORY_LOSS",
}

export enum BalanceControlMode {
  WARN = "WARN",
  BLOCK = "BLOCK",
}

// NOT_DEPRECIATED is an explicit decision, distinct from "not decided" (null).
export enum DepreciationMethod {
  STRAIGHT_LINE = "STRAIGHT_LINE",
  NOT_DEPRECIATED = "NOT_DEPRECIATED",
}

export type PolicySource = "APPROVED" | "CURRENT_BEHAVIOR" | "NOT_CONFIGURED";

export interface PolicySettingDto<T> {
  value: T | null;
  source: PolicySource;
  approvedAt: string | null;
  approvedByName: string | null;
}

export interface AccountingPolicyDto {
  negativeStockPolicy: PolicySettingDto<NegativeStockPolicy>;
  writeOffPresentation: PolicySettingDto<WriteOffPresentation>;
  returnScrapPresentation: PolicySettingDto<ReturnScrapPresentation>;
  balanceControlMode: PolicySettingDto<BalanceControlMode>;
  capitalizationThreshold: PolicySettingDto<number>;
  depreciationMethod: PolicySettingDto<DepreciationMethod>;
  depreciationUsefulLifeMonths: PolicySettingDto<number>;
  updatedAt: string | null;
}

export type AccountingPolicyField = Exclude<keyof AccountingPolicyDto, "updatedAt">;

export const ACCOUNTING_POLICY_FIELDS: AccountingPolicyField[] = [
  "negativeStockPolicy",
  "writeOffPresentation",
  "returnScrapPresentation",
  "balanceControlMode",
  "capitalizationThreshold",
  "depreciationMethod",
  "depreciationUsefulLifeMonths",
];

// Only fields present in the request change. `null` withdraws an approval and
// returns the setting to current behaviour / not configured. `reason` is
// required and goes to the audit log.
export interface UpdateAccountingPolicyRequestDto {
  negativeStockPolicy?: NegativeStockPolicy | null;
  writeOffPresentation?: WriteOffPresentation | null;
  returnScrapPresentation?: ReturnScrapPresentation | null;
  balanceControlMode?: BalanceControlMode | null;
  capitalizationThreshold?: number | null;
  depreciationMethod?: DepreciationMethod | null;
  depreciationUsefulLifeMonths?: number | null;
  reason: string;
}
