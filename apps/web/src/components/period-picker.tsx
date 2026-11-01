"use client";

import clsx from "clsx";
import { CalendarRange } from "lucide-react";
import { zonedDateKey } from "@/lib/reporting-period";
import {
  ALL_PERIOD_PRESETS,
  customPeriod,
  parseCustom,
  PERIOD_PRESET_LABELS,
  periodDays,
  type PeriodPreset,
  type PeriodValue,
} from "@/lib/period";

// One period control for every report: quick presets, «Прошлый месяц», and any
// range of days («Период» → с … по …).
export function PeriodPicker({
  value,
  onChange,
  presets = ALL_PERIOD_PRESETS,
}: {
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
  presets?: PeriodPreset[];
}) {
  const custom = parseCustom(value);
  const days = periodDays(value);
  const today = zonedDateKey();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-muted p-1">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              value === p ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {PERIOD_PRESET_LABELS[p]}
          </button>
        ))}
        <button
          // Starts from the days currently shown, then narrowed with the dates.
          onClick={() => !custom && onChange(customPeriod(days.from, days.to))}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
            custom ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
          )}
        >
          <CalendarRange className="h-4 w-4" strokeWidth={1.75} />
          Период
        </button>
      </div>
      {custom && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>с</span>
          <input
            type="date"
            value={custom.from}
            max={today}
            onChange={(e) => e.target.value && onChange(customPeriod(e.target.value, custom.to < e.target.value ? e.target.value : custom.to))}
            className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <span>по</span>
          <input
            type="date"
            value={custom.to}
            min={custom.from}
            max={today}
            onChange={(e) => e.target.value && onChange(customPeriod(custom.from, e.target.value))}
            className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
      )}
    </div>
  );
}
