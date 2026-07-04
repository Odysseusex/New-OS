import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { LocationsModule } from "./locations/locations.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ProductsModule } from "./products/products.module";
import { InventoryModule } from "./inventory/inventory.module";
import { SalesModule } from "./sales/sales.module";
import { RecipesModule } from "./recipes/recipes.module";
import { ProductionModule } from "./production/production.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    LocationsModule,
    DashboardModule,
    ProductsModule,
    InventoryModule,
    SalesModule,
    RecipesModule,
    ProductionModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
