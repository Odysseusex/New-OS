"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

// The card's colour, chosen by the customer in «Профиль» and kept on their phone.
// Terracotta is the default.

export const CARD_COLORS = {
  terracotta: {
    label: "Терракота",
    swatch: "#ad5a3e",
    vars: { "--c-bg": "linear-gradient(140deg,#d27a55 0%,#ad5a3e 52%,#7d3b29 100%)", "--c-ink": "#fff5ec", "--c-soft": "rgba(255,245,236,.78)", "--c-mark": "#ffe3c6", "--c-art": "#ffe3c6", "--c-sheen": "rgba(255,236,210,.22)", "--c-shadow": "rgba(125,59,41,.6)" },
  },
  sage: {
    label: "Шалфей",
    swatch: "#48644e",
    vars: { "--c-bg": "linear-gradient(140deg,#6f8b72 0%,#48644e 52%,#2f4535 100%)", "--c-ink": "#f6f3e8", "--c-soft": "rgba(246,243,232,.74)", "--c-mark": "#ead7a6", "--c-art": "#ead7a6", "--c-sheen": "rgba(255,255,235,.18)", "--c-shadow": "rgba(47,69,53,.7)" },
  },
  champagne: {
    label: "Шампань",
    swatch: "#e0bf86",
    vars: { "--c-bg": "linear-gradient(140deg,#f6e8cc 0%,#e6c992 50%,#cfa263 100%)", "--c-ink": "#2a1c13", "--c-soft": "rgba(42,28,19,.62)", "--c-mark": "#4a2e18", "--c-art": "#fffaf0", "--c-sheen": "rgba(255,255,255,.55)", "--c-shadow": "rgba(160,112,52,.55)" },
  },
  night: {
    label: "Ночь",
    swatch: "#18233a",
    vars: { "--c-bg": "linear-gradient(140deg,#2b3a55 0%,#18233a 52%,#0e1525 100%)", "--c-ink": "#f4eee2", "--c-soft": "rgba(244,238,226,.7)", "--c-mark": "#dcbb82", "--c-art": "#dcbb82", "--c-sheen": "rgba(170,195,255,.14)", "--c-shadow": "rgba(14,21,37,.7)" },
  },
  milk: {
    label: "Молочный",
    swatch: "#f3e9da",
    vars: { "--c-bg": "linear-gradient(140deg,#ffffff 0%,#f8f1e6 58%,#efe3cf 100%)", "--c-ink": "#2a1c13", "--c-soft": "rgba(42,28,19,.58)", "--c-mark": "#9c6c35", "--c-art": "#c49a5f", "--c-sheen": "rgba(255,255,255,.9)", "--c-shadow": "rgba(120,90,50,.35)" },
  },
} as const;

export type CardColor = keyof typeof CARD_COLORS;
const KEY = "aa.club.cardColor";
const EVENT = "aa-card-color";

function read(): CardColor {
  try {
    const v = localStorage.getItem(KEY);
    return v && v in CARD_COLORS ? (v as CardColor) : "terracotta";
  } catch {
    return "terracotta";
  }
}

export function useCardColor(): [CardColor, (c: CardColor) => void] {
  const [color, setColor] = useState<CardColor>("terracotta");
  useEffect(() => {
    setColor(read());
    const on = () => setColor(read());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const choose = (c: CardColor) => {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      // kept for this visit only
    }
    setColor(c);
    window.dispatchEvent(new Event(EVENT));
  };
  return [color, choose];
}

export const cardStyle = (c: CardColor) => CARD_COLORS[c].vars as unknown as CSSProperties;
