import { DepreciationMethod } from "./accounting-policy";

export enum FixedAssetStatus {
  ACTIVE = "ACTIVE",
  DISPOSED = "DISPOSED",
}

export const FIXED_ASSET_STATUS_LABELS_RU: Record<FixedAssetStatus, string> = {
  [FixedAssetStatus.ACTIVE]: "В эксплуатации",
  [FixedAssetStatus.DISPOSED]: "Выбыло",
};

// Where an asset stands on depreciation. Nothing is inferred: an asset with no
// stated terms is NOT_CONFIGURED and carries no depreciation.
export enum DepreciationStatus {
  NOT_CONFIGURED = "NOT_CONFIGURED",
  NOT_DEPRECIATED = "NOT_DEPRECIATED",
  DEPRECIATING = "DEPRECIATING",
  FULLY_DEPRECIATED = "FULLY_DEPRECIATED",
}

export const DEPRECIATION_STATUS_LABELS_RU: Record<DepreciationStatus, string> = {
  [DepreciationStatus.NOT_CONFIGURED]: "Метод не задан",
  [DepreciationStatus.NOT_DEPRECIATED]: "Не амортизируется",
  [DepreciationStatus.DEPRECIATING]: "Амортизируется",
  [DepreciationStatus.FULLY_DEPRECIATED]: "Полностью самортизировано",
};

export interface FixedAssetDto {
  id: string;
  name: string;
  note: string | null;
  locationId: string | null;
  locationName: string | null;
  acquisitionCost: number;
  acquiredAt: string;
  sourceExpenseId: string | null;
  isOpening: boolean;
  status: FixedAssetStatus;
  depreciationMethod: DepreciationMethod | null;
  usefulLifeMonths: number | null;
  salvageValue: number | null;
  depreciationStartYear: number | null;
  depreciationStartMonth: number | null;
  depreciationStatus: DepreciationStatus;
  // Charge per month once configured; null when it depreciates nothing.
  monthlyDepreciation: number | null;
  accumulatedDepreciation: number;
  bookValue: number;
  disposedAt: string | null;
  disposalProceeds: number | null;
  disposalBookValue: number | null;
  disposalResult: number | null;
}

export interface UnregisteredCapitalExpenseDto {
  expenseId: string;
  description: string | null;
  categoryName: string | null;
  amount: number;
  incurredOn: string;
  // The approved capitalization threshold (if any) is higher than this amount.
  belowThreshold: boolean;
}

export interface RegisterFixedAssetRequestDto {
  name: string;
  // Registers the asset from a capital expense; the cost is that expense's amount.
  sourceExpenseId?: string;
  // OR an opening asset (owned before the books started): cost and date are stated.
  opening?: { acquisitionCost: number; acquiredAt: string; reason?: string };
  locationId?: string;
  note?: string;
}

export interface SetDepreciationTermsRequestDto {
  // null clears the terms (allowed only while nothing has been depreciated).
  method: DepreciationMethod | null;
  usefulLifeMonths?: number;
  salvageValue?: number;
  startYear?: number;
  startMonth?: number;
}

export interface DisposeFixedAssetRequestDto {
  disposedAt: string;
  proceeds?: number;
  accountId?: string;
}

export interface DepreciationRunResultDto {
  // Entries created by this run; a repeat run creates none.
  created: number;
  alreadyPosted: number;
  notConfigured: number;
  months: { year: number; month: number; created: number }[];
}

export interface DepreciationEntryDto {
  id: string;
  assetId: string;
  assetName: string;
  year: number;
  month: number;
  amount: number;
  method: DepreciationMethod;
}
