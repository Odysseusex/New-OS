import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { OrganizationsModule } from "../organizations/organizations.module";
import { LocationsModule } from "../locations/locations.module";

@Module({
  imports: [OrganizationsModule, LocationsModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
