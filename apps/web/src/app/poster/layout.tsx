import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./poster.css";

// A printable A4 poster for the till: a QR to the customer app.
const sans = Manrope({ subsets: ["latin", "cyrillic"], weight: ["500", "600", "700"], variable: "--font-pp-sans", display: "swap" });

export const metadata: Metadata = { title: "Плакат для кассы — Ar Amir", robots: { index: false } };

export default function PosterLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pp ${sans.variable}`}>{children}</div>;
}
