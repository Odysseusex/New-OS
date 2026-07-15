import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { CustomersModule } from "../customers/customers.module";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";

@Module({
  imports: [InventoryModule, CustomersModule],
  providers: [NotificationsService],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
