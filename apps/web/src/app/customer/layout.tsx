import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./customer.css";

// The buyer's screen has its own look (the bakery's palette and typefaces, as on
// the public site) — nothing here reaches the ERP's styles.
const serif = Cormorant_Garamond({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["500", "600"],
  variable: "--font-cd-serif",
  display: "swap",
});
const sans = Manrope({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cd-sans",
  display: "swap",
});

export const metadata: Metadata = { title: "Ар Амир" };

export default function CustomerDisplayLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${serif.variable} ${sans.variable}`}>{children}</div>;
}
