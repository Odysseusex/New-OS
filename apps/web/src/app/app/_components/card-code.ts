"use client";

import { useEffect, useState } from "react";
import { CARD_CODE_STEP_SECONDS, cardCodeStep, cardPayload, truncateCardCode } from "@bakery-os/shared";

// The rotating card code, computed on the phone (works offline once the card is
// loaded): HMAC-SHA256(secret, step) → six digits, step = 30 s of SERVER time
// (the phone's own clock may be off; `offsetMs` corrects it).

async function codeFor(secret: string, step: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(step)));
  return truncateCardCode(new Uint8Array(sig));
}

export function useCardCode(secret: string | null, phone: string | null, offsetMs: number) {
  const [state, setState] = useState<{ code: string; payload: string; left: number } | null>(null);

  useEffect(() => {
    if (!secret || !phone) return;
    let cancelled = false;
    let lastStep = -1;
    let code = "";
    const tick = async () => {
      const now = Date.now() + offsetMs;
      const step = cardCodeStep(now);
      if (step !== lastStep) {
        lastStep = step;
        code = await codeFor(secret, step);
      }
      const left = CARD_CODE_STEP_SECONDS - Math.floor((now / 1000) % CARD_CODE_STEP_SECONDS);
      if (!cancelled) setState({ code, payload: cardPayload(phone, code), left });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [secret, phone, offsetMs]);

  return state;
}
