import { Unit } from "./catalog";

// «Требование-накладная» (ТЗ §4): the workshop asks the warehouse for raw
// materials for its production plan; posting moves them (a transfer between
// own points, no money).

export enum MaterialRequisitionStatus {
  DRAFT = "DRAFT",
  POSTED = "POSTED",
}

export const MATERIAL_REQUISITION_STATUS_LABELS_RU: Record<MaterialRequisitionStatus, string> = {
  [MaterialRequisitionStatus.DRAFT]: "Черновик",
  [MaterialRequisitionStatus.POSTED]: "Проведено",
};

export interface MaterialRequisitionLineDto {
  productId: string;
  productName: string;
  unit: Unit;
  // By the recipes for the plan; null = added by hand.
  requiredQuantity: number | null;
  quantity: number;
  // Stock now at the warehouse and at the workshop (for a draft; null once posted).
  fromStock: number | null;
  toStock: number | null;
}

export interface MaterialRequisitionDto {
  id: string;
  // REQUISITION = требование-накладная; TRANSFER = Склад → «Перемещение».
  kind: "REQUISITION" | "TRANSFER";
  number: number;
  status: MaterialRequisitionStatus;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  // YYYY-MM-DD (Almaty).
  planDate: string;
  batchIds: string[];
  note: string | null;
  createdByName: string;
  createdAt: string;
  postedByName: string | null;
  postedAt: string | null;
  lines: MaterialRequisitionLineDto[];
}

export interface RequisitionPlanBatchDto {
  id: string;
  productName: string;
  unit: Unit;
  plannedQuantity: number;
  status: string;
}

// What the plan needs: the tasks of that day at the workshop and the norm of
// every stocked ingredient for the chosen ones.
export interface RequisitionNeedDto {
  batches: RequisitionPlanBatchDto[];
  lines: MaterialRequisitionLineDto[];
  // Semi-finished ingredients with no active recipe (cannot be expanded).
  missing: string[];
}

export interface MaterialRequisitionLineInputDto {
  productId: string;
  requiredQuantity?: number | null;
  quantity: number;
}

export interface CreateMaterialRequisitionRequestDto {
  fromLocationId: string;
  toLocationId: string;
  planDate: string;
  batchIds?: string[];
  note?: string;
  lines: MaterialRequisitionLineInputDto[];
}

export interface UpdateMaterialRequisitionRequestDto {
  note?: string;
  lines: MaterialRequisitionLineInputDto[];
}

export const MATERIAL_REQUISITION_MAX_LINES = 200;

export interface CreateStockTransferRequestDto {
  fromLocationId: string;
  toLocationId: string;
  note?: string;
  lines: { productId: string; quantity: number }[];
}

// Сверка выдачи (ТЗ §4): what the warehouse issued to a workshop by requisitions over a
// period against what the batches completed there consumed — at the norm and in fact.
// «Выдано сверх нормы» = issued − norm (positive: more was issued than the output needed).
export interface RequisitionIssueLineDto {
  productId: string;
  productName: string;
  unit: Unit;
  issued: number;
  issuedValue: number;
  norm: number;
  normValue: number;
  // Norm + overuse written off at completion − savings.
  actual: number;
  overIssued: number;
  overIssuedValue: number;
}

export interface RequisitionIssueReportDto {
  locationId: string;
  from: string;
  to: string;
  lines: RequisitionIssueLineDto[];
  totals: { issuedValue: number; normValue: number; overIssuedValue: number };
}
