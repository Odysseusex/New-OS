import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { SITE_INFO } from "./site-info";
import "./site.css";

const serif = Cormorant_Garamond({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-s-serif",
  display: "swap",
});
const sans = Manrope({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-s-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${SITE_INFO.brand} — традиционная пекарня`,
  description: "Ар Амир — традиционная пекарня: хлеб, багеты, круассаны, торты и сладкая выпечка собственного производства. Бонусная программа для постоянных гостей.",
  icons: { icon: "/site/logo-256.png", apple: "/site/logo-256.png" },
  openGraph: {
    title: `${SITE_INFO.brand} — традиционная пекарня`,
    description: "Хлеб, багеты, круассаны, торты и сладкая выпечка собственного производства.",
    images: ["/site/hero-loaves.jpg"],
    locale: "ru_KZ",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#fbf7f0",
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`s-site ${serif.variable} ${sans.variable}`}>
      {/* Flags the page before it paints so reveal-on-scroll starts hidden only
          when JS will be there to reveal it. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('s-js')" }} />
      {children}
    </div>
  );
}
