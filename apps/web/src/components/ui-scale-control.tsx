"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { applyUiScale, readUiScale, UI_SCALE_STEPS } from "@/lib/ui-scale";

// − 90 % + : the screen's scale on this device.
export function UiScaleControl() {
  const [scale, setScale] = useState(100);
  useEffect(() => setScale(readUiScale()), []);

  const step = (direction: 1 | -1) => {
    const index = UI_SCALE_STEPS.indexOf(scale);
    const next = UI_SCALE_STEPS[Math.min(UI_SCALE_STEPS.length - 1, Math.max(0, (index === -1 ? UI_SCALE_STEPS.indexOf(100) : index) + direction))];
    setScale(next);
    applyUiScale(next);
  };

  return (
    <div className="flex shrink-0 items-center rounded-xl border border-border bg-surface" title="Масштаб экрана на этом устройстве">
      <button
        onClick={() => step(-1)}
        disabled={scale === UI_SCALE_STEPS[0]}
        aria-label="Уменьшить"
        className="flex h-10 w-9 items-center justify-center rounded-l-xl text-foreground transition hover:bg-surface-muted disabled:opacity-40"
      >
        <Minus className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <button
        onClick={() => {
          setScale(100);
          applyUiScale(100);
        }}
        className="min-w-[3.25rem] px-1 text-center text-sm font-medium tabular-nums text-foreground"
        title="Сбросить на 100 %"
      >
        {scale}%
      </button>
      <button
        onClick={() => step(1)}
        disabled={scale === UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1]}
        aria-label="Увеличить"
        className="flex h-10 w-9 items-center justify-center rounded-r-xl text-foreground transition hover:bg-surface-muted disabled:opacity-40"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
