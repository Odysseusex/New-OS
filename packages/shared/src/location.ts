export enum LocationType {
  BAKERY_PRODUCTION = "BAKERY_PRODUCTION",
  STORE = "STORE",
  WAREHOUSE = "WAREHOUSE",
}

export const LOCATION_TYPE_LABELS_RU: Record<LocationType, string> = {
  [LocationType.BAKERY_PRODUCTION]: "Производство",
  [LocationType.STORE]: "Точка продаж",
  [LocationType.WAREHOUSE]: "Склад",
};
