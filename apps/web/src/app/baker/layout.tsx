import type { Metadata } from "next";

// The bakers' phone screen installs on a home screen as its own app: «Накладные», opening straight
// on /baker (the ERP keeps «ArAmir OS» from the root layout).
export const metadata: Metadata = {
  title: "Накладные пекаря",
  manifest: "/baker/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Накладные", statusBarStyle: "default" },
  // Its own icon (owner, 25.11.2026): the «ar» with the chef's hat on terracotta.
  icons: {
    icon: [
      { url: "/baker/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/baker/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/baker/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function BakerLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen min-h-[100dvh] bg-background text-foreground">{children}</div>;
}
