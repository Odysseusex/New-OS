import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { LocationsModule } from "./locations/locations.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ProductsModule } from "./products/products.module";
import { CategoriesModule } from "./categories/categories.module";
import { InventoryModule } from "./inventory/inventory.module";
import { SalesModule } from "./sales/sales.module";
import { RecipesModule } from "./recipes/recipes.module";
import { ProductionModule } from "./production/production.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { ProcurementModule } from "./procurement/procurement.module";
import { VehiclesModule } from "./vehicles/vehicles.module";
import { LogisticsModule } from "./logistics/logistics.module";
import { FinanceModule } from "./finance/finance.module";
import { HrModule } from "./hr/hr.module";
import { CustomersModule } from "./customers/customers.module";
import { UsersModule } from "./users/users.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { QualityModule } from "./quality/quality.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AiModule } from "./ai/ai.module";
import { TelegramModule } from "./telegram/telegram.module";
import { FiscalModule } from "./fiscal/fiscal.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    LocationsModule,
    DashboardModule,
    ProductsModule,
    CategoriesModule,
    InventoryModule,
    SalesModule,
    RecipesModule,
    ProductionModule,
    SuppliersModule,
    ProcurementModule,
    VehiclesModule,
    LogisticsModule,
    FinanceModule,
    HrModule,
    CustomersModule,
    UsersModule,
    InvoicesModule,
    QualityModule,
    NotificationsModule,
    AiModule,
    TelegramModule,
    FiscalModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
