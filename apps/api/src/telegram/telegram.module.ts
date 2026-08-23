import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { SalesModule } from "../sales/sales.module";
import { LocationsModule } from "../locations/locations.module";
import { ProductsModule } from "../products/products.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { CustomersModule } from "../customers/customers.module";
import { FinanceModule } from "../finance/finance.module";
import { ProductionModule } from "../production/production.module";
import { RecipesModule } from "../recipes/recipes.module";
import { TelegramController } from "./telegram.controller";
import { TelegramBotService } from "./telegram-bot.service";
import { TelegramAuthResolver } from "./telegram-auth.resolver";
import { TelegramLinkService } from "./telegram-link.service";
import { TelegramPendingActionService } from "./telegram-pending-action.service";
import { TelegramChatStateService } from "./telegram-chat-state.service";
import { TelegramNotificationsCron } from "./telegram-notifications.cron";

@Module({
  imports: [
    InventoryModule,
    SalesModule,
    LocationsModule,
    ProductsModule,
    NotificationsModule,
    CustomersModule,
    FinanceModule,
    ProductionModule,
    RecipesModule,
  ],
  controllers: [TelegramController],
  providers: [
    TelegramBotService,
    TelegramAuthResolver,
    TelegramLinkService,
    TelegramPendingActionService,
    TelegramChatStateService,
    TelegramNotificationsCron,
  ],
})
export class TelegramModule {}
