import { CASH_MOVEMENT_INFLOW_TYPES, CashMovementType } from "@bakery-os/shared";

// The signed effect each ledger row has on the balance it feeds. These
// restate rules that today live inline in the services that write the rows
// (InventoryService, SalesService, ProductionService, LogisticsService,
// SaleReturnsService, CashMovementsService.recordMovement). They are read-only
// helpers for integrity checks and reports; nothing that writes a row uses
// them yet, and the contract tests pin them to what the services really do.
//
// Keyed on the database's own string values rather than the shared
// StockMovementType enum, which does not list TRANSFER_IN / TRANSFER_OUT.

// +1: adds stock, -1: removes stock, "SIGNED": the stored quantity already
// carries its direction (only ADJUSTMENT stores a signed number).
const STOCK_SIGN: Record<string, 1 | -1 | "SIGNED"> = {
  RECEIPT: 1,
  SALE: -1,
  SALE_RETURN: 1,
  WRITE_OFF: -1,
  ADJUSTMENT: "SIGNED",
  PRODUCTION_CONSUMPTION: -1,
  PRODUCTION_OUTPUT: 1,
  TRANSFER_OUT: -1,
  TRANSFER_IN: 1,
};

export type StockSign = 1 | -1 | 0 | "SIGNED";

// A return the buyer keeps or that cannot be resold is recorded as a WRITE_OFF
// movement linked to the return, but the sale already took that stock off the
// shelf and nothing puts it back — so the row is a marker with no stock
// effect. Any code that sums signed movements must treat it as zero, or it
// reports drift that is not there.
export function isReturnScrapMarker(movement: { type: string; saleReturnId?: string | null }): boolean {
  return movement.type === "WRITE_OFF" && !!movement.saleReturnId;
}

export function stockSignOf(type: string, isScrapMarker = false): StockSign {
  if (isScrapMarker) return 0;
  const sign = STOCK_SIGN[type];
  if (sign === undefined) {
    throw new Error(`Unknown stock movement type: ${type}`);
  }
  return sign;
}

export function stockEffectOf(movement: {
  type: string;
  quantity: number;
  saleReturnId?: string | null;
}): number {
  const sign = stockSignOf(movement.type, isReturnScrapMarker(movement));
  if (sign === 0) return 0;
  return sign === "SIGNED" ? movement.quantity : sign * movement.quantity;
}

// ADJUSTMENT stores a signed amount; every other type stores a positive
// magnitude whose direction comes from the type (CASH_MOVEMENT_INFLOW_TYPES).
export function cashSignOf(type: string): 1 | -1 | "SIGNED" {
  if (type === CashMovementType.ADJUSTMENT) return "SIGNED";
  return CASH_MOVEMENT_INFLOW_TYPES.includes(type as CashMovementType) ? 1 : -1;
}

export function cashEffectOf(movement: { type: string; amount: number }): number {
  const sign = cashSignOf(movement.type);
  return sign === "SIGNED" ? movement.amount : sign * movement.amount;
}
