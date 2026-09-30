import type { CashFlowDto, ProfitAndLossDto } from "./finance";

export enum FinancialPeriodStatus {
  OPEN = "OPEN",
  CLOSING = "CLOSING",
  CLOSED = "CLOSED",
}

export const FINANCIAL_PERIOD_STATUS_LABELS_RU: Record<FinancialPeriodStatus, string> = {
  [FinancialPeriodStatus.OPEN]: "Открыт",
  [FinancialPeriodStatus.CLOSING]: "Закрывается",
  [FinancialPeriodStatus.CLOSED]: "Закрыт",
};

export interface FinancialPeriodDto {
  year: number;
  month: number;
  // Instants of the month in the reporting time zone.
  from: string;
  to: string;
  status: FinancialPeriodStatus;
  version: number;
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  // Whether this is the latest closed month — the only one that can be reopened.
  canReopen: boolean;
}

// What was found when the period was (or would be) closed. Kept SEPARATE from
// the figures: a finding never changes a statement, it is reported next to it.
export interface PeriodDiagnosticsDto {
  stockDrifts: number;
  cashDrifts: number;
  eventCount: number;
  incompleteEvents: number;
  eventInvariantViolations: number;
  unclassifiedCashMovements: number;
  unknownCostLines: number;
  hasIssues: boolean;
}

export interface PeriodPreflightDto {
  year: number;
  month: number;
  canClose: boolean;
  // Reasons the period cannot be closed at all.
  blockers: string[];
  diagnostics: PeriodDiagnosticsDto;
}

export interface PeriodSnapshotPayloadDto {
  schemaVersion: number;
  year: number;
  month: number;
  from: string;
  to: string;
  // When the figures were computed. Receivables/payables are positions at this moment.
  asOf: string;
  pnl: ProfitAndLossDto;
  cashFlow: CashFlowDto;
  accountsReceivable: number;
  accountsPayable: number;
  // Later phases add sections here; older snapshots simply do not have them.
  [section: string]: unknown;
}

export interface PeriodSnapshotDto {
  id: string;
  year: number;
  month: number;
  version: number;
  createdAt: string;
  createdByName: string;
  supersededAt: string | null;
  supersededReason: string | null;
  payload: PeriodSnapshotPayloadDto;
  diagnostics: PeriodDiagnosticsDto;
}

export interface ReopenPeriodRequestDto {
  reason: string;
}

// Marks a report served from a closed period's snapshot instead of live data.
export interface FrozenReportInfoDto {
  year: number;
  month: number;
  version: number;
  closedAt: string;
}
