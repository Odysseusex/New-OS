import type { Metadata } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import "./poster.css";

// A printable A4 poster for the till: a QR to the customer app.
const serif = Playfair_Display({ subsets: ["latin", "cyrillic"], weight: ["500", "600"], variable: "--font-pp-serif", display: "swap" });
const sans = Manrope({ subsets: ["latin", "cyrillic"], weight: ["500", "600", "700"], variable: "--font-pp-sans", display: "swap" });

export const metadata: Metadata = { title: "Плакат для кассы — Ar Amir", robots: { index: false } };

export default function PosterLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pp ${serif.variable} ${sans.variable}`}>{children}</div>;
}
