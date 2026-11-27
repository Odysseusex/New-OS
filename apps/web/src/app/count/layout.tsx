import type { Metadata } from "next";

// «Пересчёт»: the cashiers' phone screen for counting the shelf. It installs on a home screen as its
// own app, opening straight on /count.
export const metadata: Metadata = {
  title: "Пересчёт остатков",
  manifest: "/count/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Пересчёт", statusBarStyle: "default" },
};

export default function CountLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen min-h-[100dvh] bg-background text-foreground">{children}</div>;
}
