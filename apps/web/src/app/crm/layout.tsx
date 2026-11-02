import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { CrmShell } from "@/components/crm/shell";
import "./crm.css";

const inter = Inter({ subsets: ["latin", "cyrillic", "cyrillic-ext"], weight: ["400", "500", "600", "700"], variable: "--font-crm", display: "swap" });

// The CRM installs on a home screen as its own app: its own name, picture and
// start page (the ERP keeps the red logo and «ArAmir OS» from the root layout).
export const metadata: Metadata = {
  title: "Ar Amir CRM",
  manifest: "/crm/manifest.webmanifest",
  icons: { icon: "/crm/icon-512.png", apple: "/crm/icon-512.png" },
  appleWebApp: { capable: true, title: "Ar Amir CRM", statusBarStyle: "default" },
};

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={inter.variable}>
      <CrmShell>{children}</CrmShell>
    </div>
  );
}
