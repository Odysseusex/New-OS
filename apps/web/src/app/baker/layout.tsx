import type { Metadata } from "next";

// The bakers' phone screen installs on a home screen as its own app: «Накладные», opening straight
// on /baker (the ERP keeps «ArAmir OS» from the root layout).
export const metadata: Metadata = {
  title: "Накладные пекаря",
  manifest: "/baker/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Накладные", statusBarStyle: "default" },
};

export default function BakerLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen min-h-[100dvh] bg-background text-foreground">{children}</div>;
}
