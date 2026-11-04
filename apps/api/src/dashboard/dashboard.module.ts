import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { OrganizationsModule } from "../organizations/organizations.module";
import { LocationsModule } from "../locations/locations.module";
import { SalesModule } from "../sales/sales.module";
import { InventoryModule } from "../inventory/inventory.module";
import { DebtsModule } from "../debts/debts.module";
import { FinanceModule } from "../finance/finance.module";
import { DashboardFinanceService } from "./dashboard-finance.service";

@Module({
  imports: [OrganizationsModule, LocationsModule, SalesModule, InventoryModule, DebtsModule, FinanceModule],
  providers: [DashboardFinanceService],
  controllers: [DashboardController],
})
export class DashboardModule {}
