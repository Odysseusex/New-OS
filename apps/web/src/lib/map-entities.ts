import type { CustomerDto, LocationOverviewDto } from "@bakery-os/shared";
import { LocationType } from "@bakery-os/shared";

// Provider-agnostic point on the map. Both the built-in SVG renderer and any
// future external map provider (2GIS, Google Maps) consume this same shape —
// swapping the renderer means implementing a component with the same props
// contract as CityMap (entities, selectedId, onSelect), nothing upstream changes.
export type MapEntityKind = "PRODUCTION" | "WAREHOUSE" | "STORE" | "CUSTOMER";

export interface MapEntity {
  id: string;
  kind: MapEntityKind;
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
  todayRevenue: number | null;
  lowStockCount: number | null;
  outstandingBalance: number | null;
  detailHref: string;
}

const LOCATION_TYPE_TO_KIND: Record<LocationType, MapEntityKind> = {
  [LocationType.BAKERY_PRODUCTION]: "PRODUCTION",
  [LocationType.WAREHOUSE]: "WAREHOUSE",
  [LocationType.STORE]: "STORE",
};

export function locationsToMapEntities(locations: LocationOverviewDto[]): MapEntity[] {
  return locations
    .filter((l): l is LocationOverviewDto & { lat: number; lng: number } => l.lat != null && l.lng != null)
    .map((l) => ({
      id: l.id,
      kind: LOCATION_TYPE_TO_KIND[l.type],
      name: l.name,
      subtitle: `${l.city}, ${l.address}`,
      lat: l.lat,
      lng: l.lng,
      todayRevenue: l.todayRevenue,
      lowStockCount: l.lowStockCount,
      outstandingBalance: null,
      detailHref: "/network",
    }));
}

export function customersToMapEntities(customers: CustomerDto[]): MapEntity[] {
  return customers
    .filter((c): c is CustomerDto & { lat: number; lng: number } => c.lat != null && c.lng != null)
    .map((c) => ({
      id: c.id,
      kind: "CUSTOMER" as const,
      name: c.name,
      subtitle: c.address ?? "Клиент",
      lat: c.lat,
      lng: c.lng,
      todayRevenue: null,
      lowStockCount: null,
      outstandingBalance: c.outstandingBalance,
      detailHref: "/customers",
    }));
}
