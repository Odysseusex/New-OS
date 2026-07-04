import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { OrganizationsModule } from "../organizations/organizations.module";
import { LocationsModule } from "../locations/locations.module";
import { SalesModule } from "../sales/sales.module";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  imports: [OrganizationsModule, LocationsModule, SalesModule, InventoryModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
