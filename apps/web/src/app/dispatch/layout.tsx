import type { Metadata } from "next";

export const metadata: Metadata = { title: "Выдача накладных" };

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen min-h-[100dvh] bg-background text-foreground">{children}</div>;
}
