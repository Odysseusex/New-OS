import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { CrmShell } from "@/components/crm/shell";
import "./crm.css";

const inter = Inter({ subsets: ["latin", "cyrillic", "cyrillic-ext"], weight: ["400", "500", "600", "700"], variable: "--font-crm", display: "swap" });

export const metadata: Metadata = {
  title: "Ар Амир CRM",
};

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={inter.variable}>
      <CrmShell>{children}</CrmShell>
    </div>
  );
}
