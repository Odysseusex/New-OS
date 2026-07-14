"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { Factory, Package, Store, Users, type LucideIcon } from "lucide-react";
import type { MapEntity, MapEntityKind } from "@/lib/map-entities";
import { projectToPercent } from "@/lib/geo";

const KIND_STYLES: Record<MapEntityKind, { color: string; icon: LucideIcon }> = {
  PRODUCTION: { color: "#b6702f", icon: Factory },
  STORE: { color: "#2563eb", icon: Store },
  WAREHOUSE: { color: "#0d9488", icon: Package },
  CUSTOMER: { color: "#7c3aed", icon: Users },
};

// Consumes only provider-agnostic MapEntity points + a selection callback.
// A future 2GIS/Google Maps renderer can implement this exact same props
// contract and be swapped in at the call site without touching data loading.
export function CityMap({
  entities,
  selectedId,
  onSelect,
}: {
  entities: MapEntity[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const points = useMemo(() => projectToPercent(entities), [entities]);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-surface">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <defs>
          <pattern id="mapGrid" width="36" height="36" patternUnits="userSpaceOnUse">
            <rect width="36" height="36" fill="none" stroke="var(--border)" strokeWidth="1" />
          </pattern>
          <radialGradient id="mapGlow" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#mapGlow)" />
        <rect width="100%" height="100%" fill="url(#mapGrid)" />
      </svg>

      {points.map((p) => {
        const style = KIND_STYLES[p.kind];
        const Icon = style.icon;
        const isSelected = p.id === selectedId;
        const isLow = (p.lowStockCount ?? 0) > 0;

        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
          >
            {isLow && (
              <span className="absolute -right-1 -top-1 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-2 ring-surface">
                !
              </span>
            )}
            <span
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md ring-4 transition",
                isSelected ? "scale-110 ring-accent/30" : "ring-surface/80 group-hover:scale-105",
              )}
              style={{ backgroundColor: style.color }}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-lg transition group-hover:opacity-100">
              {p.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
