import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./club.css";

// The customer app (ar-amir.com/app): a bonus card customers add to their home
// screen. Its own look (the bakery's palette from the public site), its own
// manifest and icon — nothing of the ERP's.

const serif = Cormorant_Garamond({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["500", "600"],
  variable: "--font-aa-serif",
  display: "swap",
});
const sans = Manrope({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-aa-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ар Амир — бонусная карта",
  description: "Бонусная карта пекарни Ар Амир: баланс, история покупок и QR-код для кассы.",
  manifest: "/site/app/manifest.webmanifest",
  icons: { icon: "/site/app/icon-192.png", apple: "/site/app/icon-180.png" },
  appleWebApp: { capable: true, title: "Ар Амир", statusBarStyle: "default" },
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#130e0a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function ClubLayout({ children }: { children: React.ReactNode }) {
  return <div className={`aa ${serif.variable} ${sans.variable}`}>{children}</div>;
}
