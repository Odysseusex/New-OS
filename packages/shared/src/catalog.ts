export enum Unit {
  PCS = "PCS",
  KG = "KG",
  G = "G",
  L = "L",
}

export const UNIT_LABELS_RU: Record<Unit, string> = {
  [Unit.PCS]: "шт",
  [Unit.KG]: "кг",
  [Unit.G]: "г",
  [Unit.L]: "л",
};

export interface ProductDto {
  id: string;
  name: string;
  sku: string;
  unit: Unit;
  category: string;
  price: number;
  isActive: boolean;
}

export interface CreateProductRequestDto {
  name: string;
  sku: string;
  unit: Unit;
  category: string;
  price: number;
}
