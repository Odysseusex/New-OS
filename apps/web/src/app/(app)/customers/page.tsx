import { Handshake } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";
import { allNavItems } from "@/lib/nav";
import { moduleUpcoming } from "@/lib/module-details";

const item = allNavItems.find((i) => i.href === "/customers")!;

export default function Page() {
  return (
    <ModulePlaceholder
      icon={Handshake}
      title={item.label}
      description={item.description}
      upcoming={moduleUpcoming["/customers"]}
    />
  );
}
