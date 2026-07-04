import { BarChart3 } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";
import { allNavItems } from "@/lib/nav";
import { moduleUpcoming } from "@/lib/module-details";

const item = allNavItems.find((i) => i.href === "/reports")!;

export default function Page() {
  return (
    <ModulePlaceholder
      icon={BarChart3}
      title={item.label}
      description={item.description}
      upcoming={moduleUpcoming["/reports"]}
    />
  );
}
