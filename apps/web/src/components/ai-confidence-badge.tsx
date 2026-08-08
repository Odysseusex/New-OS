import { SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { AI_CONFIDENCE_LABELS_RU, AiConfidence } from "@bakery-os/shared";

const ICONS: Record<AiConfidence, typeof SignalHigh> = {
  [AiConfidence.HIGH]: SignalHigh,
  [AiConfidence.MEDIUM]: SignalMedium,
  [AiConfidence.LOW]: SignalLow,
};

export function AiConfidenceBadge({ confidence }: { confidence: AiConfidence }) {
  const Icon = ICONS[confidence];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {AI_CONFIDENCE_LABELS_RU[confidence]}
    </span>
  );
}
