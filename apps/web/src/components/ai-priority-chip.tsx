import clsx from "clsx";
import { AI_INSIGHT_PRIORITY_LABELS_RU, AiInsightPriority } from "@bakery-os/shared";

const STYLES: Record<AiInsightPriority, string> = {
  [AiInsightPriority.CRITICAL]: "bg-red-50 text-red-700",
  [AiInsightPriority.HIGH]: "bg-orange-50 text-orange-700",
  [AiInsightPriority.MEDIUM]: "bg-amber-50 text-amber-700",
  [AiInsightPriority.LOW]: "bg-surface-muted text-muted",
};

export function AiPriorityChip({ priority }: { priority: AiInsightPriority }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", STYLES[priority])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {AI_INSIGHT_PRIORITY_LABELS_RU[priority]}
    </span>
  );
}
