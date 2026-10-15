"use client";

import clsx from "clsx";
import type { LoyaltyConsentStateDto } from "@bakery-os/shared";
import {
  LOYALTY_CONSENT_CHANNEL_LABELS_RU,
  LOYALTY_CONSENT_CHANNELS,
  LOYALTY_CONSENT_SOURCE_LABELS_RU,
  LOYALTY_MEMBER_STATUS_LABELS_RU,
  LoyaltyConsentSource,
  LoyaltyMemberStatus,
} from "@bakery-os/shared";

export const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// «Импорт» is set only by a file upload, never picked by hand.
export const MANUAL_CONSENT_SOURCES: LoyaltyConsentSource[] = [
  LoyaltyConsentSource.AT_TILL,
  LoyaltyConsentSource.PAPER_FORM,
  LoyaltyConsentSource.OTHER,
];

export function ConsentSourceSelect({ value, onChange }: { value: LoyaltyConsentSource; onChange: (v: LoyaltyConsentSource) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as LoyaltyConsentSource)} className={inputClass}>
      {MANUAL_CONSENT_SOURCES.map((s) => (
        <option key={s} value={s}>
          {LOYALTY_CONSENT_SOURCE_LABELS_RU[s]}
        </option>
      ))}
    </select>
  );
}

export function MemberStatusBadge({ status }: { status: LoyaltyMemberStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        status === LoyaltyMemberStatus.ACTIVE && "bg-emerald-50 text-emerald-700",
        status === LoyaltyMemberStatus.WITHDRAWN && "bg-red-50 text-red-700",
        status === LoyaltyMemberStatus.MERGED && "bg-surface-muted text-muted",
      )}
    >
      {LOYALTY_MEMBER_STATUS_LABELS_RU[status]}
    </span>
  );
}

export function marketingLabel(consents: LoyaltyConsentStateDto): string {
  const open = LOYALTY_CONSENT_CHANNELS.filter((c) => consents.marketing[c]).map((c) => LOYALTY_CONSENT_CHANNEL_LABELS_RU[c]);
  return open.length ? open.join(", ") : "—";
}
